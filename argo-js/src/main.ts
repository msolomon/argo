import { ExecutionResult, DocumentNode, GraphQLSchema } from 'graphql'
import { ArgoEncoder } from './encoder'
import { ArgoDecoder } from './decoder'
import { Wire } from './wire'
import { Buf } from './buf'
import { Typer } from './typer'

/**
 * Main entry point for encoding and decoding an ExecutionResult.
 * 
 * This uses an interpreted approach, where the wire schema is walked over to convert each result.
 * Better approaches would be to use code generation, or to write values directly
 * to an output buffer without going through a JS object at all.
 */
export class ExecutionResultCodec {
  readonly typer: Typer

  constructor(
    readonly schema: GraphQLSchema,
    readonly query: DocumentNode,
    operationName?: string
  ) {
    this.typer = new Typer(schema, query, operationName)
  }

  jsToArgo(js: object): Buf {
    const encoder = new ArgoEncoder()
    encoder.header.outOfBandFieldErrors = true // this reference implementation doesn't implement in-band field errors
    // uncomment the following to try out noBlocks and selfDescribing modes
    // encoder.header.noBlocks = true
    // encoder.header.selfDescribing = true
    const type = encoder.header.selfDescribing ? Wire.DESC : this.typer.rootWireType()
    encoder.jsToArgoWithType(js, type)
    return encoder.getResult()
  }

  argoToJs(bytes: Buf): ExecutionResult {
    const decoder = new ArgoDecoder(bytes)
    return decoder.argoToJsWithType(this.typer.rootWireType())
  }
}

