/**
 * @jest-environment ./test/equivalence/equivalence-environment
 */

import * as fs from 'fs'
import * as path from 'path'
import { buildSchema, parse, DocumentNode, GraphQLSchema } from 'graphql'
import { Interpreter, Typer } from '../../src'
import { brotliCompressSync, gzipSync, constants } from 'zlib'
import zstd from '@mongodb-js/zstd'
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

test('Star Wars equivalence tests', async () => {
  const starwarsDir = path.join(path.dirname(testPath), 'starwars')
  for await (const { name, query, json, expected, dir } of loadTests(starwarsDir)) {
    console.log("Running test:", name)
    await runEquivalence(query, json, StarWarsSchema, expected)
  }
})

test('Queries are serialized equivalently', async () => {
  for await (const { name, dir, query, json, schema, expected } of loadTests()) {
    if (dir.includes('starwars')) continue
    console.log("Running test:", name)
    await runEquivalence(query, json, schema, expected)
  }
})

test('Typer', async () => {
  const starwarsDir = path.join(path.dirname(testPath), 'starwars')
  for await (const { name, query, json, expected } of loadTests(starwarsDir)) {
    if (name != 'Overlap') continue
    const schema = StarWarsSchema
    console.log("Running typer test:", name)
    const typer = new Typer(schema, query)

    const rootWireType = typer.rootWireType() // should not throw
  }
})

async function runEquivalence(query: DocumentNode, json: string, schema: GraphQLSchema, expected: any) {
  const ci = new Interpreter(schema, query)

  const cedarBytes = ci.jsToCedar(expected)
  cedarBytes.compact() // make sure we don't have usused space, since later we access the underlying array

  const compactJson = JSON.stringify(expected)
  const compactJsonLength = new TextEncoder().encode(compactJson).byteLength

  cedarBytes.resetPosition() // start at the beginning, not the end
  const fromCedarResult = ci.cedarToJs(cedarBytes)

  const cedarToJson = JSON.stringify(fromCedarResult, null, 2)
  expect(cedarToJson).toEqual(json)

  // Compression levels have to be picked somehow, so this is all (very roughly) normalized around gzip level 6 performance
  // For GraphQL responses, I would suggest using Brotli where supported (at quality level 4) and falling back to gzip (level 6) otherwise
  const GzipLevel = 6 // Apache and CLI default. NGINX uses 1
  const BrotliQuality = 4 // rough equivalent of gzip 6 based on https://dev.to/coolblue/improving-website-performance-with-brotli-5h70
  const ZstdLevel = 6 // very rough single-core equivalent of above based on https://community.centminmod.com/threads/round-4-compression-comparison-benchmarks-zstd-vs-brotli-vs-pigz-vs-bzip2-vs-xz-etc.18669/

  const brotliJsonSize = brotliCompressSync(compactJson, { params: { [constants.BROTLI_PARAM_QUALITY]: BrotliQuality } }).byteLength
  const gzipJsonSize = gzipSync(compactJson, { level: GzipLevel }).byteLength
  const zstdJsonSize = (await zstd.compress(Buffer.from(compactJson), ZstdLevel)).byteLength
  const brotliCedarSize = brotliCompressSync(cedarBytes.uint8array, { params: { [constants.BROTLI_PARAM_QUALITY]: BrotliQuality } }).byteLength
  const gzipCedarSize = gzipSync(cedarBytes.uint8array, { level: GzipLevel }).byteLength
  const zstdCedarSize = (await zstd.compress(Buffer.from(cedarBytes.uint8array), ZstdLevel)).byteLength
  const savedWithCedar = (json: number, cedar: number) => `${(json - cedar).toLocaleString("en-US")} bytes (${100 - Math.round(cedar / json * 100)}%)`

  const sizes = {
    uncompressed: { json: compactJsonLength, cedar: cedarBytes.length, saved: savedWithCedar(compactJsonLength, cedarBytes.length) },
    gzip: { level: GzipLevel, json: gzipJsonSize, cedar: gzipCedarSize, saved: savedWithCedar(gzipJsonSize, gzipCedarSize) },
    brotli: { level: BrotliQuality, json: brotliJsonSize, cedar: brotliCedarSize, saved: savedWithCedar(brotliJsonSize, brotliCedarSize) },
    zstd: { level: ZstdLevel, json: zstdJsonSize, cedar: zstdCedarSize, saved: savedWithCedar(zstdJsonSize, zstdCedarSize) },
  }

  const smallest = Object.entries(sizes).reduce(([lastName, last], [nextName, next]) => {
    if (Math.min(last.json, last.cedar) <= Math.min(next.json, next.cedar)) return [lastName, last]
    else return [nextName, next]
  })

  console.log(
    `Cedar saved ${smallest[1].saved} using ${smallest[0]}\n`,
    sizes
  )
}
