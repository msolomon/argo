
import { ExecutionResult, DocumentNode, GraphQLSchema } from 'graphql'
import { CedarEncoder } from './encoder'
import { CedarDecoder } from './decoder'
import { Typer } from './wire'
import { Buf } from './buf'


export class CedarInterpreter {
  readonly typer: Typer

  constructor(
    readonly schema: GraphQLSchema,
    readonly query: DocumentNode,
    operationName?: string
  ) {
    this.typer = new Typer(schema, query, operationName)
  }

  jsToCedar(js: object): Buf {
    const encoder = new CedarEncoder()
    encoder.jsToCedarWithType(js, this.typer.rootWireType())
    return encoder.getResult()
  }

  cedarToJs(bytes: Buf): ExecutionResult {
    const decoder = new CedarDecoder(bytes)
    return decoder.cedarToJsWithType(this.typer.rootWireType())
  }
}

