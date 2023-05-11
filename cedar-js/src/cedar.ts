
import { GraphQLCompositeType, Kind, visit, GraphQLType, FieldNode, ExecutionResult, ASTNode, OperationTypeNode, ResponsePath, GraphQLTypeResolver, GraphQLFieldResolver, GraphQLAbstractType, DocumentNode, GraphQLResolveInfo, GraphQLSchema, TypedQueryDocumentNode, } from 'graphql'
import * as graphql from 'graphql'
import { assert } from 'console'
import { addPath, Path } from 'graphql/jsutils/Path'
import { Label, LabelKind } from './label'
import { CedarEncoder } from './encoder'
import { CedarDecoder } from './decoder'
import { BackreferenceReaderTracker, BackreferenceWriterTracker, ValueDeduplicator } from './dedup'
import { Typer, Wire } from './wire'
import { WriteStream } from 'fs'
import { ZigZag } from './varint'
import { Buf } from './buf'


type AbstractTypeInfo = {
  value: any
  context: any
  info: GraphQLResolveInfo
  abstractType: GraphQLAbstractType
}

const DEBUG = true


interface MarkedResolver extends GraphQLFieldResolver<any, any> {
  patched: boolean | undefined
}

export interface WithInfo {
  cedarInfo: GraphQLResolveInfo | undefined
}

export interface CedarInfo {
  // resolveInfo: GraphQLResolveInfo
  path: Path
  parentType: GraphQLType
  type: GraphQLType
  value: any
  children: CedarInfo[]
}


/**
 * To use:
 * - Construct one of these, e.g. const ci = new CedarInterpreter(...)
 * - Your schema is patch automatically
 * - If you override your ExecutionContext's `typeResolver`, patch it too:
 *   - globalTypeResolver = ci.patchTypeResolver(globalTypeResolver)
 */
export class CedarInterpreter {
  abstractTypeInfo: Map<ResponsePath, AbstractTypeInfo> = new Map()
  // info: Map<any, CedarInfo> = new Map()
  lastSeen: CedarInfo | undefined
  typer: Typer

  constructor(
    readonly schema: GraphQLSchema,
    readonly query: DocumentNode,
    operationName?: string
    // readonly options: CedarOptions = new CedarOptions(),
  ) {
    this.typer = new Typer(schema, query, operationName)
    // if (options.autoPatchSchema) { this.patchSchemaResolvers() }
  }


  // encode(encoder: CedarEncoder, rawV: any, t: GraphQLType, parentType: GraphQLType) {
  //   let v = rawV
  //   if (graphql.isScalarType(t) || graphql.isEnumType(t)) {
  //     v = t.serialize(rawV) // these types may have differing internal and external representations
  //   }
  //   // console.log('writing', v, t.toString())
  //   let nullable = graphql.isNonNullType(parentType)
  //   if (graphql.isNonNullType(t)) {
  //     nullable = false
  //     t = t.ofType
  //   }
  //   encoder.tracked.push({ pos: encoder.pos, t: t.toString() })
  //   if (nullable && v == null) {
  //     // console.log('writing null')
  //     encoder.tracked.push({ pos: encoder.pos, 'wrote null': v })
  //     return encoder.writeLabelNull()
  //   }

  //   if (graphql.isObjectType(t) || graphql.isAbstractType(t)) {
  //     // console.log('writing object', t.toString())
  //     // if (typeof (v) !== 'object') throw `Value ${v} needed to be object at ${path}`
  //     if (nullable) {
  //       // console.log('nullable')
  //       const backref = encoder.objectTracker.labelForValue(v)
  //       if (backref !== null) {
  //         encoder.tracked.push({ pos: encoder.pos, 'deduped object': v })
  //         return encoder.writeVarInt(backref)
  //       }
  //       // console.log('writing non-null (maybe)')
  //       encoder.writeLabelNonNull() // FYI this may be overwritten later
  //     }
  //   } else if (graphql.isScalarType(t)) {
  //     // console.log('writing scalar', t.name, v)
  //     switch (t) {
  //       case graphql.GraphQLString: encoder.stringDedup.dedup(v); break
  //       default: throw "unimplemented"
  //     }
  //   } else if (graphql.isEnumType(t)) {
  //     encoder.enumDedup.dedup(v)
  //   } else if (graphql.isListType(t)) {
  //     // TODO: support encoding in continuable chunks, as per spec. or drop from spec
  //     const backref = encoder.listTracker.labelForValue(v)
  //     if (backref !== null) return encoder.writeVarInt(backref)
  //     // TODO: fix this. the resolver doesn't hit the list itself, only the parent and each object's children
  //     const innerT = t.ofType as graphql.GraphQLNamedOutputType
  //     if (!Array.isArray(v)) { throw "Lists must be represented with arrays" }
  //     // console.log('writing list of', innerT.name, v.length)
  //     encoder.writeVarInt(v.length)
  //     // console.log(new Error().stack)

  //     v.forEach((child, i) => {
  //       this.encode(encoder, child, innerT, t)
  //     })
  //   } else {
  //     // console.log(t, info)
  //     throw `unimplemented: type ${t}`
  //   }
  // }

  // private defaultGetCedar: (contextValue: any) => CedarEncoder =
  //   (contextValue: any) => {
  //     if ('cedarEncoder' in contextValue) return contextValue.cedarEncoder
  //     else throw "Cedar did not find a CedarEncoder in the cedarEncoder field of the execution " +
  //     "context value. Set it there by using CedarInterpreter's newCedarEncocder(), " +
  //     "or override the getCedar function in getFieldResolver"
  //   }

  // newCedarEncoder(): CedarEncoder {
  //   return new CedarEncoder()
  // }

  // wrapSchemaResolvers(
  //   schema: GraphQLSchema,
  //   // get a cedar instance from the context
  //   getCedarEncoder: (contextValue: unknown) => CedarEncoder = this.defaultGetCedar
  // ) {
  //   for (const t of Object.values(schema.getTypeMap())) {
  //     if (graphql.isObjectType(t) || graphql.isInterfaceType(t)) {
  //       for (const f of Object.values(t.getFields())) {
  //         f.resolve = this.wrapResolver(f.resolve, getCedarEncoder)
  //       }
  //     }
  //   }
  //   return schema
  // }

  // wrapResolver(
  //   resolver: GraphQLFieldResolver<unknown, unknown> | undefined,
  //   // get a cedar instance from the context
  //   getCedarEncoder: (contextValue: unknown) => CedarEncoder = this.defaultGetCedar
  // ): GraphQLFieldResolver<unknown, unknown> | undefined {
  //   if (resolver == undefined) return undefined
  //   if ((resolver as MarkedResolver).patched) {
  //     throw 'Tried to wrap resolver for Cedar, but it has already been wrapped. '
  //     + 'Please wrap resolvers exactly once.'
  //   }
  //   const newResolver: GraphQLFieldResolver<unknown, unknown> = (source, args, contextValue, info) => {
  //     const encoder = getCedarEncoder(contextValue)
  //     const resolved = resolver(source, args, contextValue, info)
  //     // console.log('resolved', resolved, new Error().stack)
  //     this.encode(encoder, resolved, info.returnType, info.parentType)
  //     return resolved
  //   }
  //   (newResolver as MarkedResolver).patched = true
  //   return newResolver
  // }

  // /**
  //  * A field resolver for use with graphql-js' `execute`.
  //  * 
  //  * Cedar needs to collect runtime type information, and it uses this to do it.
  //  * @returns 
  //  */
  // getFieldResolver(
  //   // get a cedar instance from the context
  //   getCedarEncoder: (contextValue: unknown) => CedarEncoder = this.defaultGetCedar
  // ): GraphQLFieldResolver<unknown, unknown> {
  //   return this.wrapResolver(graphql.defaultFieldResolver)!
  // }

  // fromCedar(bytes: Uint8Array): object | null {
  //   const cedarThis = this
  //   let pos = 0
  //   const result: ExecutionResult = {}
  //   const stringDedup = new BackreferenceReaderTracker<string>()
  //   const enumDedup = new BackreferenceReaderTracker<string>()
  //   const idDedup = new BackreferenceReaderTracker<string>()
  //   const objectTracker = new BackreferenceReaderTracker<object>()
  //   const listTracker = new BackreferenceReaderTracker<Array<unknown>>()
  //   const bump = (numNewBytes: number): number => (
  //     pos += numNewBytes
  //     // assert(pos < buffer.byteLength, "Ran out of space in buffer")
  //   )
  //   // const tracked: { pos: number, kind: string, value: any, bytes: Uint8Array }[] = []
  //   const tracked: any[] = []
  //   function track(pos: number, kind: string, value: any, length: number) {
  //     if (DEBUG) tracked.push({ pos, kind, value, bytes: new Uint8Array(bytes.buffer, pos, length) })
  //   }

  //   const readLabel = (): bigint => {
  //     const { label, length } = Label.decode(bytes, pos)
  //     if (DEBUG) track(pos, 'label', label, length)
  //     // tracked.push({ pos, 'trace': new Error().stack })
  //     // console.log('reading label at', pos, new Uint8Array(bytes.buffer, pos, length), ':', label)
  //     bump(length)
  //     return label
  //   }
  //   const readBytesRaw = (length: number): Uint8Array => {
  //     const buf = new Uint8Array(bytes.buffer, pos, length)
  //     if (DEBUG) track(pos, 'bytes', null, length)
  //     bump(length)
  //     return buf
  //   }
  //   const readString = (length: number): string => {
  //     // const buf = readBytesRaw(length)
  //     // return cedarThis.utf8decode.decode(buf)
  //     const buf = new Uint8Array(bytes.buffer, pos, length)
  //     const str = cedarThis.utf8decode.decode(buf)
  //     if (DEBUG) track(pos, 'string', str, length)
  //     bump(length)
  //     return str
  //   }

  //   const readCedar = (t: GraphQLType): any => {
  //     if (graphql.isObjectType(t) || graphql.isInterfaceType(t)) {
  //       // TODO: support object de-duping
  //       return {}
  //     } else if (graphql.isScalarType(t)) {
  //       switch (t) {
  //         case graphql.GraphQLString: {
  //           const label = readLabel()
  //           if (Label.isError(label)) {
  //             throw 'TODO: handle error'
  //           }
  //           const str = stringDedup.valueForLabel(label, readString)
  //           // console.log('reading', t.name, label, str)
  //           return str
  //         }
  //         default: throw `unimplemented scalar ${t}`
  //       }
  //     } else if (graphql.isEnumType(t)) {
  //       const label = readLabel()
  //       if (Label.isError(label)) {
  //         throw 'TODO: handle error'
  //       }
  //       return enumDedup.valueForLabel(label, readString)
  //     } else if (graphql.isNonNullType(t)) {
  //       return readCedar(t.ofType)
  //     } else if (graphql.isListType(t)) {
  //       const label = readLabel()
  //       // console.log('reading list', t.toString(), 'length', label)
  //       return listTracker.valueForLabel(label, length => new Array(Number(length)))
  //     } else {
  //       throw `unimplemented: reading ${t}`
  //     }
  //   }

  //   // TODO: actually read the flags
  //   const flags = readBytesRaw(1)
  //   assert(flags.byteLength == 1, flags[0] == 0)
  //   console.log(bytes)

  //   type Frame = {
  //     parentT: GraphQLType,
  //     parentName: string,
  //     getType: (n: FieldNode) => GraphQLType,
  //     addToParent: (alias: string, c: any) => void,
  //   }
  //   let stack: Frame[] = []

  //   const getTypeFromObject = (t: graphql.GraphQLObjectType | graphql.GraphQLInterfaceType) => {
  //     return (node: FieldNode) => {
  //       // console.log(node.name.value, Object.keys(t.getFields()))
  //       // console.log(t.toString(), stack.map(p => p.parentName))
  //       // console.log(new Error().stack)
  //       if (t.getFields()[node.name.value] == null) debugger
  //       return t.getFields()[node.name.value].type
  //     }
  //   }

  //   const readStack = () => { return stack[stack.length - 1] }

  //   const handleField = (node: FieldNode): any => {
  //     const { parentName, parentT, addToParent, getType } = readStack()
  //     const t = getType(node)
  //     const alias = node.alias?.value ?? node.name.value
  //     // console.log('ENTER', alias, '\n\t', stack.map(f => `${f.parentName}: ${f.parentT}`).join("\n\t"))
  //     // console.log(`${parentName}.${alias}:`, t.toString(), ',child of', parentT.toString())
  //     // console.log(new Error().stack)

  //     if (graphql.isNonNullType(t)) {
  //       // console.log('nonnull type', t.toString())
  //       // stack.pop()
  //       stack.push({
  //         parentName: alias,
  //         parentT: t.ofType,
  //         addToParent,
  //         getType: (n: FieldNode) => t.ofType,
  //       })
  //       const toReturn = handleField(node)
  //       stack.pop()
  //       return toReturn
  //     }

  //     tracked.push({ pos, t: t.toString() })
  //     const v = readCedar(t)
  //     // console.log(result)
  //     addToParent(alias, v)
  //     // console.log(result, '\n\tREAD', t.toString(), alias, '=', v)
  //     // console.log(stack)

  //     if (graphql.isScalarType(t) || graphql.isEnumType(t)) {
  //       // console.log('done with scalar', alias)
  //       return null
  //     }

  //     if (graphql.isObjectType(t) || graphql.isInterfaceType(t)) {
  //       assert(node.selectionSet, "Uh-oh... expected selection set for", t)
  //       stack.push({
  //         parentName: alias,
  //         parentT: t,
  //         addToParent: (alias: string, c: any) => {
  //           // console.log('adding', c, 'to', v, 'as', alias)
  //           return (v as { [key: string]: any })[alias] = c
  //         },
  //         getType: getTypeFromObject(t),
  //       })
  //       return
  //     }

  //     if (graphql.isListType(t)) {
  //       // recursively walk the entire subquery for every item in the list
  //       for (let i = 0; i < (v as any[]).length; i++) {
  //         // console.log('recursing on', alias)
  //         stack.push({
  //           parentName: alias,
  //           parentT: t,
  //           addToParent: (alias: string, c: any) => v[i] = c, // TODO: is this right?
  //           getType: (n: FieldNode) => t.ofType,
  //         })
  //         visit(node, recursionBox.visitor)
  //         stack.pop()
  //       }
  //       // console.log('list result', v)
  //       return null // do NOT continue visiting children nodes
  //     }

  //     throw 'unimplemented ' + t
  //   }



  //   const recursionBox: { visitor: graphql.ASTVisitor } = { visitor: {} }
  //   const visitor: graphql.ASTVisitor = {
  //     enter(node, key, parent, path, ancestors) {
  //       // console.log(node.kind)
  //       switch (node.kind) {
  //         case Kind.FIELD:
  //           return handleField(node)
  //         case Kind.FRAGMENT_DEFINITION:
  //           console.log(node)

  //           throw 'need to support definition'
  //         // case Kind.FRAGMENT_SPREAD:
  //         //   throw 'need to support spread'

  //         case Kind.OPERATION_DEFINITION: {
  //           // set the root type, usually Query
  //           const t = cedarThis.schema.getRootType(node.operation)!
  //           const data: any = {}
  //           stack.push({
  //             // t: cedarThis.schema.getRootType(node.operation)!,
  //             parentT: t,
  //             parentName: node.operation,
  //             addToParent: (alias: string, c: any) => {
  //               result.data = data // TODO: don't assume query
  //               return data[alias] = c
  //             },
  //             getType: getTypeFromObject(t)
  //           })
  //           break
  //         }

  //       }
  //     },

  //     leave(node, key, parent, path, ancestors) {
  //       switch (node.kind) {
  //         case Kind.FIELD:
  //           const popped = stack.pop()
  //           // console.log('popped', popped?.parentName, 'expected', node.alias?.value ?? node.name.value)
  //           // console.log('LEAVE', '\n\t', stack.map(f => `${f.parentName}: ${f.parentT}`).join("\n\t"))

  //           break
  //         case Kind.DOCUMENT:
  //           return result
  //       }
  //     }
  //   }
  //   recursionBox.visitor = visitor // tie the recursive knot
  //   const visitResult = visit(this.query, visitor)
  //   console.log('@@ Read log', tracked)
  //   return visitResult
  // }

  jsToCedar(js: object): Buf {
    const encoder = new CedarEncoder()
    // console.log('@@ root wire', Wire.print(this.typer.rootWireType()))
    // console.log('@@ root wire', JSON.stringify(this.typer.rootWireType()))
    encoder.startMessage()
    encoder.jsToCedarWithType(js, this.typer.rootWireType(), encoder)
    // console.log('write log', encoder.tracked)
    return encoder.getResult()
  }

  cedarToJs(bytes: Buf): ExecutionResult {
    const decoder = new CedarDecoder(bytes)
    return decoder.cedarToJsWithType(this.typer.rootWireType())
  }
}

