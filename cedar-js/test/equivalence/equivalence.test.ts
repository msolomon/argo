/**
 * @jest-environment ./test/equivalence/equivalence-environment
 */

import * as fs from 'fs'
import * as path from 'path'
import { buildSchema, parse, DocumentNode, GraphQLSchema } from 'graphql'
import { CedarInterpreter } from '../../src'
import { brotliCompressSync, gzipSync, constants } from 'zlib'
import zstd from '@mongodb-js/zstd'

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

// function valueToResolver(schema: GraphQLSchema, t: GraphQLType, v: any, r: graphql.ExecutionResult, path: (string | number)[]): any {
//   switch (typeof (v)) {
//     case 'object':
//       if (v == null) {
//         // console.log(path)
//         if (r.errors && r.errors.length > 0) {
//           if (path.length == 0 && graphql.isObjectType(t)) { // global errors
//             return () => { throw new graphql.GraphQLError(r.errors![0].message) }
//           }
//           return v
//         }
//       }

//       if (!Array.isArray(v) && (graphql.isObjectType(t) || graphql.isInterfaceType(t))) {
//         const newObj: any = {}
//         for (const k in v) {
//           newObj[k] = valueToResolver(schema, t.getFields()[k].type, v[k], r, path.concat([k]))
//         }
//         if (graphql.isInterfaceType(t) && t.resolveType == null) {
//           // for interfaces, just pick the first one, unless __typename tells us which it is
//           let objType = schema.getImplementations(t).objects[0].name
//           if (v['__typename'] != null) {
//             objType = schema.getImplementations(t).objects.find((i => i.name == v['__typename']))!.name
//           }
//           t.resolveType = () => objType
//         }
//         return newObj
//       }
//     // fall through for arrays
//     default:
//       return v
//   }
// }





// function valueToResolver2(
//   schema: GraphQLSchema,
//   query: DocumentNode,
//   t: GraphQLType, v: any, r: graphql.ExecutionResult,
//   path: (string | number)[]): any {
//   {
//     type Frame = {
//       parentT: GraphQLType,
//       parentName: string,
//       getType: (n: FieldNode) => GraphQLType,
//       addToParent: (alias: string, c: any) => void,
//     }
//     let stack: Frame[] = []
//     let result: graphql.ExecutionResult = {}

//     const getTypeFromObject = (t: graphql.GraphQLObjectType | graphql.GraphQLInterfaceType) => {
//       return (node: FieldNode) => {
//         // console.log(node.name.value, Object.keys(t.getFields()))
//         // console.log(t.toString(), stack.map(p => p.parentName))
//         // console.log(new Error().stack)
//         return t.getFields()[node.name.value].type
//       }
//     }

//     const readStack = () => { return stack[stack.length - 1] }

//     const handleField = (node: FieldNode): any => {
//       const { parentName, parentT, addToParent, getType } = readStack()
//       const t = getType(node)
//       const alias = node.alias?.value ?? node.name.value
//       // console.log('ENTER', alias, '\n\t', stack.map(f => `${f.parentName}: ${f.parentT}`).join("\n\t"))
//       // console.log(`${parentName}.${alias}:`, t.toString(), ',child of', parentT.toString())
//       // console.log(new Error().stack)

//       if (graphql.isNonNullType(t)) {
//         // console.log('nonnull type', t.toString())
//         // stack.pop()
//         stack.push({
//           parentName: alias,
//           parentT: t.ofType,
//           addToParent,
//           getType: (n: FieldNode) => t.ofType,
//         })
//         const toReturn = handleField(node)
//         stack.pop()
//         return toReturn
//       }

//       // const v = readCedar(t)
//       // console.log(result)
//       addToParent(alias, v)
//       // console.log(result, '\n\tREAD', t.toString(), alias, '=', v)
//       // console.log(stack)

//       if (graphql.isScalarType(t) || graphql.isEnumType(t)) {
//         // console.log('done with scalar', alias)
//         return null
//       }

//       if (graphql.isObjectType(t) || graphql.isInterfaceType(t)) {
//         assert(node.selectionSet, "Uh-oh... expected selection set for", t)
//         stack.push({
//           parentName: alias,
//           parentT: t,
//           addToParent: (alias: string, c: any) => {
//             // console.log('adding', c, 'to', v, 'as', alias)
//             return (v as { [key: string]: any })[alias] = c
//           },
//           getType: getTypeFromObject(t),
//         })
//         return
//       }

//       if (graphql.isListType(t)) {
//         // recursively walk the entire subquery for every item in the list
//         for (let i = 0; i < (v as any[]).length; i++) {
//           // console.log('recursing on', alias)
//           stack.push({
//             parentName: alias,
//             parentT: t,
//             addToParent: (alias: string, c: any) => v[i] = c, // TODO: is this right?
//             getType: (n: FieldNode) => t.ofType,
//           })
//           graphql.visit(node, recursionBox.visitor)
//           stack.pop()
//         }
//         // console.log('list result', v)
//         return null // do NOT continue visiting children nodes
//       }

//       throw 'unimplemented ' + t
//     }



//     const recursionBox: { visitor: graphql.ASTVisitor } = { visitor: {} }
//     const visitor: graphql.ASTVisitor = {
//       enter(node, key, parent, path, ancestors) {
//         // console.log(node.kind)
//         switch (node.kind) {
//           case Kind.FIELD:
//             return handleField(node)

//           case Kind.OPERATION_DEFINITION: {
//             // set the root type, usually Query
//             const data: any = {}
//             const t = schema.getRootType(node.operation)!
//             stack.push({
//               // t: cedarThis.schema.getRootType(node.operation)!,
//               parentT: t,
//               parentName: node.operation,
//               addToParent: (alias: string, c: any) => {
//                 result.data = data // TODO: don't assume query
//                 return data[alias] = c
//               },
//               getType: getTypeFromObject(t)
//             })
//             break
//           }

//         }
//       },

//       leave(node, key, parent, path, ancestors) {
//         switch (node.kind) {
//           case Kind.FIELD:
//             const popped = stack.pop()
//             // console.log('popped', popped?.parentName, 'expected', node.alias?.value ?? node.name.value)
//             // console.log('LEAVE', '\n\t', stack.map(f => `${f.parentName}: ${f.parentT}`).join("\n\t"))

//             break
//           case Kind.DOCUMENT:
//             return result
//         }
//       }
//     }
//     recursionBox.visitor = visitor // tie the recursive knot
//     return graphql.visit(query, visitor)
//   }
// }

// function hasAllRequiredFields(v: { [key: string]: any }, t: GraphQLInterfaceType): boolean {
//   const keys = new Set(Object.keys(v))
//   for (const k in t.getFields()) {
//     if (!keys.has(k)) return false
//   }
//   return true
// }

// const runEquivalence = async (resolvers: any, query: DocumentNode, json: string, schema: GraphQLSchema, expected: any) => {
//   // const ci = new CedarInterpreter(schema, query, new CedarOptions(false))
//   const ci = new CedarInterpreter(schema, query)
//   const cedarEncoder = ci.newCedarEncoder()

//   // don't wrap resolvers more than once if re-using across tests
//   if (!schema.description?.includes('Patched for Cedar')) {
//     ci.wrapSchemaResolvers(schema)
//     schema.description += ' Patched for Cedar.'
//   }

//   const result = graphql.executeSync({
//     schema,
//     document: query,
//     rootValue: resolvers,
//     contextValue: { cedarEncoder },
//     fieldResolver: ci.getFieldResolver()
//   })

//   console.log('@@ Write log', cedarEncoder.tracked)


//   // console.log(resolvers)

//   // console.log((result as WithInfo).cedarInfo)
//   // console.log(ci.info.get('R2-D2')?.resolveInfo.fieldNodes)
//   console.log(JSON.stringify(result, null, 2))
//   expect(JSON.stringify(result, null, 2)).toEqual(json)
//   const compactJson = JSON.stringify(result)
//   const compactJsonLength = new TextEncoder().encode(compactJson).byteLength
//   // TODO: actually run through cedar

//   const cedarBytes = cedarEncoder.getResult()
//   const brotliJsonSize = brotliCompressSync(compactJson).byteLength
//   const gzipJsonSize = gzipSync(compactJson).byteLength
//   const brotliCedarize = brotliCompressSync(cedarBytes).byteLength
//   const gzipCedarSize = gzipSync(cedarBytes).byteLength

//   console.log(`Saved ${compactJsonLength - cedarBytes.byteLength} bytes (saved ${100 - Math.round(cedarBytes.byteLength / compactJsonLength * 100)}%).\n\tCompact JSON: ${compactJsonLength}\n\tCedar: ${cedarBytes.byteLength}\n`, {
//     brotliJsonSize,
//     gzipJsonSize,
//     brotliCedarize,
//     gzipCedarSize,
//   })
//   const fromCedarResult = ci.fromCedar(cedarBytes)
//   expect(JSON.stringify(fromCedarResult, null, 2)).toEqual(json)

//   // console.log(ci.abstractTypeInfo)
// }




// TODO: re-enable

// test('Star Wars equivalence tests', async () => {
//   const starwarsDir = path.join(path.dirname(testPath), 'starwars')
//   for await (const { name, query, json, expected, dir } of loadTests(starwarsDir)) {
//     // if (name != 'NestedQuery') continue
//     console.log("Running test:", name)
//     runEquivalence(query, json, StarWarsSchema, expected)
//   }
// })


test('Queries are serialized equivalently', async () => {
  for await (const { name, dir, query, json, schema, expected } of loadTests()) {
    if (dir.includes('starwars')) continue
    console.log("Running test:", name)
    // const resolvers = valueToResolver(schema, schema.getQueryType()!, expected.data, expected, [])
    await runEquivalence(query, json, schema, expected)
  }
})

// test('Typer', async () => {
//   const starwarsDir = path.join(path.dirname(testPath), 'starwars')
//   for await (const { name, query, json, expected } of loadTests(starwarsDir)) {
//     if (name != 'Overlap') continue
//     const schema = StarWarsSchema
//     console.log("Running typer test:", name)
//     const typer = new Typer(schema, query)

//     const rootWireType = typer.rootWireType()
//     console.log(JSON.stringify(rootWireType, undefined, 2))
//     // console.log(typer.types)
//   }
// })
async function runEquivalence(query: DocumentNode, json: string, schema: GraphQLSchema, expected: any) {
  const ci = new CedarInterpreter(schema, query)

  const cedarBytes = ci.jsToCedar(expected)

  const compactJson = JSON.stringify(expected)
  const compactJsonLength = new TextEncoder().encode(compactJson).byteLength

  cedarBytes.resetPosition() // start at the beginning, not the end
  const fromCedarResult = ci.cedarToJs(cedarBytes)

  const cedarToJson = JSON.stringify(fromCedarResult, null, 2)
  expect(cedarToJson).toEqual(json)

  // Compression levels have to be picked somehow, so this is all (very roughly) normalized around gzip level 6 performance
  // In my experience, brotli is good at large responses but bad at small ones, gzip is ok at everything, and zstd is good at everything
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

  console.log(
    `Cedar saved ${savedWithCedar(gzipJsonSize, gzipCedarSize)} assuming gzip compression\n`,
    {
      uncompressed: { json: compactJsonLength, cedar: cedarBytes.length, saved: savedWithCedar(compactJsonLength, cedarBytes.length) },
      gzip: { level: GzipLevel, json: gzipJsonSize, cedar: gzipCedarSize, saved: savedWithCedar(gzipJsonSize, gzipCedarSize) },
      brotli: { level: BrotliQuality, json: brotliJsonSize, cedar: brotliCedarSize, saved: savedWithCedar(brotliJsonSize, brotliCedarSize) },
      zstd: { level: ZstdLevel, json: zstdJsonSize, cedar: zstdCedarSize, saved: savedWithCedar(zstdJsonSize, zstdCedarSize) },
    })
}

// test('Star Wars encoding with Typer', async () => {
//   const starwarsDir = path.join(path.dirname(testPath), 'starwars')
//   for await (const { name, query, json, expected, dir } of loadTests(starwarsDir)) {
//     // if (name != 'IntrospectFieldArgs') continue
//     console.log("Running test:", name, dir)
//     await runEquivalence(query, json, StarWarsSchema, expected)
//     continue
//     const schema = StarWarsSchema
//     const ci = new CedarInterpreter(schema, query)
//     // const cedarEncoder = ci.newCedarEncoder()

//     // // don't wrap resolvers more than once if re-using across tests
//     // if (!schema.description?.includes('Patched for Cedar')) {
//     //   ci.wrapSchemaResolvers(schema)
//     //   schema.description += ' Patched for Cedar.'
//     // }

//     const result = await graphql.execute({
//       schema,
//       document: query,
//       // rootValue: resolvers,
//       // contextValue: { cedarEncoder },
//       // fieldResolver: ci.getFieldResolver()
//     })

//     // console.log('@@ Write log', cedarEncoder.tracked)

//     // console.log('JS RESULT', JSON.stringify(result, undefined, 2))

//     const cedarBytes = ci.jsToCedar(result)
//     // console.log(Wire.print(ci.typer.rootWireType()))
//     // console.log('CEDAR BYTES', cedarBytes)

//     // console.log('Write log', ci.typer)


//     // console.log((result as WithInfo).cedarInfo)
//     // console.log(ci.info.get('R2-D2')?.resolveInfo.fieldNodes)
//     // console.log(JSON.stringify(result, null, 2))
//     expect(JSON.stringify(result, null, 2)).toEqual(json)
//     const compactJson = JSON.stringify(result)
//     const compactJsonLength = new TextEncoder().encode(compactJson).byteLength

//     const fromCedarResult = ci.cedarToJsWithType(cedarBytes, ci.typer.rootWireType())
//     // console.log(JSON.stringify(fromCedarResult, null, 2))
//     expect(JSON.stringify(fromCedarResult, null, 2)).toEqual(json)

//     // const cedarBytes = cedarEncoder.getResult()
//     const brotliJsonSize = brotliCompressSync(compactJson).byteLength
//     const gzipJsonSize = gzipSync(compactJson).byteLength
//     const brotliCedarize = brotliCompressSync(cedarBytes).byteLength
//     const gzipCedarSize = gzipSync(cedarBytes).byteLength

//     console.log(`Saved ${compactJsonLength - cedarBytes.byteLength} bytes (saved ${100 - Math.round(cedarBytes.byteLength / compactJsonLength * 100)}%).\n\tCompact JSON: ${compactJsonLength}\n\tCedar: ${cedarBytes.byteLength}\n`, {
//       brotliJsonSize,
//       gzipJsonSize,
//       brotliCedarize,
//       gzipCedarSize,
//     })
//   }
// })
