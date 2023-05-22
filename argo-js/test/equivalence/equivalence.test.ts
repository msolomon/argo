/**
 * @jest-environment ./test/equivalence/equivalence-environment
 */

import * as fs from 'fs'
import * as path from 'path'
import { buildSchema, parse, DocumentNode, GraphQLSchema } from 'graphql'
import { ExecutionResultCodec, Typer } from '../../src'
import { brotliCompressSync, gzipSync, constants } from 'zlib'
import zstd from '@mongodb-js/zstd'
import * as lz4 from 'lz4'
import { transEncodeSync } from '@capnp-js/trans-packing'
import { StarWarsSchema } from './starwarsequivalence'

jest.setTimeout(10000)

declare global { // from equivalence-environment
  var testPath: string
}

function slurp(file: Promise<fs.promises.FileHandle> | string): Promise<string> {
  if (typeof (file) === 'string') {
    return slurp(fs.promises.open(file))
  }
  return file.then(f => {
    const contents = f.readFile({ encoding: 'utf8' })
    f.close()
    return contents
  })
}

async function* loadTests(dir: string = path.dirname(testPath)) {
  let count = 0
  for await (const path of walk(dir, true)) {
    for await (const test of loadTest(path)) {
      yield test
      count++
    }
  }
  if (count == 0) for await (const test of loadTest(dir)) { yield test }
}

async function* loadTest(dir: string) {
  const schema = buildSchema(await slurp(path.join(dir, 'schema.graphql')))
  const queries: Map<string, DocumentNode> = new Map()
  const results: Map<string, any> = new Map()
  for await (const p of walk(dir)) {
    if (p.endsWith('/schema.graphql')) continue
    else if (p.endsWith('.graphql'))
      queries.set(path.basename(p, '.graphql'), parse(await slurp(p)))
    else if (p.endsWith('.json'))
      results.set(path.basename(p, '.json'), await JSON.parse(await slurp(p)))
    else if (p.includes('disabled')) continue
    else throw `Got unexpected file in test: ${p}`
  }
  expect(queries.size).toBeGreaterThan(0)
  expect(new Set(queries.keys())) // each query file must have a result file and vice versa
    .toEqual(new Set(results.keys()))

  for (const [name, query] of queries.entries()) {
    const expected = results.get(name)!
    const json = JSON.stringify(expected, null, 2)
    yield {
      dir,
      name,
      schema,
      query,
      expected,
      json
    }
  }
}

async function* walk(dir: string, dirsOnly: boolean = false): AsyncGenerator<string> {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory() && !d.name.includes('disabled')) {
      yield entry
      yield* walk(entry, dirsOnly);
    }
    else if (d.isFile() && !dirsOnly) yield entry;
  }
}

// this is Cap'n Proto's packing algorithm, which basically compresses long strings of 0 bytes
// see https://capnproto.org/encoding.html#packing
function capnpPackedLength(bytes: Uint8Array): number {
  const encode = transEncodeSync(new Uint8Array(2048));
  let done = false
  const source = {
    next() {
      if (!done) {
        done = true
        return { done: false, value: bytes }
      }
      else return { done }
    },
  }
  const packed = encode(source);
  let length = 0
  let p = packed.next()
  while (!p.done) {
    length += p.value.length
    p = packed.next()
  }
  return length
}

test('Star Wars equivalence tests', async () => {
  const starwarsDir = path.join(path.dirname(testPath), 'starwars')
  for await (const { name, query, json, expected, dir } of loadTests(starwarsDir)) {
    console.log("============================================================\nRunning test:", name)
    await runEquivalence(name, query, json, StarWarsSchema, expected)
  }
})

test('Queries are serialized equivalently', async () => {
  for await (const { name, dir, query, json, schema, expected } of loadTests()) {
    if (dir.includes('starwars')) continue
    console.log("============================================================\nRunning test:", name)
    await runEquivalence(name, query, json, schema, expected)
  }
})

test('Typer', async () => {
  const starwarsDir = path.join(path.dirname(testPath), 'starwars')
  for await (const { name, query, json, expected } of loadTests(starwarsDir)) {
    const schema = StarWarsSchema
    const typer = new Typer(schema, query)

    const rootWireType = typer.rootWireType() // should not throw
  }
})

async function runEquivalence(name: string, query: DocumentNode, json: string, schema: GraphQLSchema, expected: any) {
  const ci = new ExecutionResultCodec(schema, query)

  const argoBytes = ci.jsToArgo(expected)
  argoBytes.compact() // make sure we don't have usused space, since later we access the underlying array
  argoBytes.resetPosition() // start at the beginning, not the end

  const compactJson = JSON.stringify(expected)
  const compactJsonLength = new TextEncoder().encode(compactJson).byteLength

  const fromArgoResult = ci.argoToJs(argoBytes)

  const argoToJson = JSON.stringify(fromArgoResult, null, 2)
  expect(argoToJson).toEqual(json)

  // Compression levels have to be picked somehow, so this is (very roughly) normalized around gzip level 6 performance
  // For GraphQL responses, I would suggest using Brotli where supported (at quality level 4) and falling back to gzip (level 6) otherwise
  const GzipLevel = 6 // Apache and CLI default. NGINX uses 1
  const BrotliQuality = 4 // rough equivalent of gzip 6 based on https://dev.to/coolblue/improving-website-performance-with-brotli-5h70
  const ZstdLevel = 6 // very rough single-core equivalent of above based on https://community.centminmod.com/threads/round-4-compression-comparison-benchmarks-zstd-vs-brotli-vs-pigz-vs-bzip2-vs-xz-etc.18669/
  // LZ4 uses the default level (not high-compression mode) and is included for consideration as a fast compression algorithm
  // Cap'n Proto's packing algorithm has no levels, and is included as an extremely fast pseudo-compression algorithm

  const brotliJsonSize = brotliCompressSync(compactJson, { params: { [constants.BROTLI_PARAM_QUALITY]: BrotliQuality } }).byteLength
  const gzipJsonSize = gzipSync(compactJson, { level: GzipLevel }).byteLength
  const zstdJsonSize = (await zstd.compress(Buffer.from(compactJson), ZstdLevel)).byteLength
  const lz4JsonSize = lz4.encode(Buffer.from(compactJson), { streamChecksum: false }).byteLength
  const capnpJsonSize = capnpPackedLength(Buffer.from(compactJson))
  const brotliArgoSize = brotliCompressSync(argoBytes.uint8array, { params: { [constants.BROTLI_PARAM_QUALITY]: BrotliQuality } }).byteLength
  const gzipArgoSize = gzipSync(argoBytes.uint8array, { level: GzipLevel }).byteLength
  const zstdArgoSize = (await zstd.compress(Buffer.from(argoBytes.uint8array), ZstdLevel)).byteLength
  const lz4ArgoSize = lz4.encode(Buffer.from(argoBytes.uint8array), { streamChecksum: false }).byteLength
  const capnpArgoSize = capnpPackedLength(Buffer.from(argoBytes.uint8array))
  const savedWithArgo = (json: number, argo: number) => `${(json - argo).toLocaleString("en-US")} bytes (${100 - Math.round(argo / json * 100)}%)`

  const sizes: { [index: string]: any } = {
    uncompressed: { level: 0, json: compactJsonLength, argo: argoBytes.length, saved: savedWithArgo(compactJsonLength, argoBytes.length) },
    capnp_pack: { json: capnpJsonSize, argo: capnpArgoSize, saved: savedWithArgo(capnpJsonSize, capnpArgoSize) },
    lz4: { json: lz4JsonSize, argo: lz4ArgoSize, saved: savedWithArgo(lz4JsonSize, lz4ArgoSize) },
    gzip: { level: GzipLevel, json: gzipJsonSize, argo: gzipArgoSize, saved: savedWithArgo(gzipJsonSize, gzipArgoSize) },
    brotli: { level: BrotliQuality, json: brotliJsonSize, argo: brotliArgoSize, saved: savedWithArgo(brotliJsonSize, brotliArgoSize) },
    zstd: { level: ZstdLevel, json: zstdJsonSize, argo: zstdArgoSize, saved: savedWithArgo(zstdJsonSize, zstdArgoSize) },
  }

  const smallest = Object.entries(sizes).reduce(([lastName, last], [nextName, next]) => {
    if (Math.min(last.json, last.argo) <= Math.min(next.json, next.argo)) return [lastName, last]
    else return [nextName, next]
  })
  sizes[''] = {} // blank line in table
  sizes[`best (${smallest[0]})`] = smallest[1] // always show best at bottom of table

  console.table(sizes)
}
