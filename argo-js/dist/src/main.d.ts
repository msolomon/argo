import { ExecutionResult, DocumentNode, GraphQLSchema } from 'graphql';
import { Buf } from './buf';
import { Typer } from './typer';
/**
 * Main entry point for encoding and decoding an ExecutionResult.
 *
 * This uses an interpreted approach, where the wire schema is walked over to convert each result.
 * Better approaches would be to use code generation, or to write values directly
 * to an output buffer without going through a JS object at all.
 */
export declare class ExecutionResultCodec {
    readonly schema: GraphQLSchema;
    readonly query: DocumentNode;
    readonly typer: Typer;
    constructor(schema: GraphQLSchema, query: DocumentNode, operationName?: string);
    jsToArgo(js: object): Buf;
    argoToJs(bytes: Buf): ExecutionResult;
}
