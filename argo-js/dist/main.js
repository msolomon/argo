import { ArgoEncoder } from './encoder';
import { ArgoDecoder } from './decoder';
import { Wire } from './wire';
import { Typer } from './typer';
/**
 * Main entry point for encoding and decoding an ExecutionResult.
 *
 * This uses an interpreted approach, where the wire schema is walked over to convert each result.
 * Better approaches would be to use code generation, or to write values directly
 * to an output buffer without going through a JS object at all.
 */
export class ExecutionResultCodec {
    schema;
    query;
    typer;
    constructor(schema, query, operationName) {
        this.schema = schema;
        this.query = query;
        this.typer = new Typer(schema, query, operationName);
    }
    jsToArgo(js) {
        const encoder = new ArgoEncoder();
        encoder.header.outOfBandFieldErrors = true; // this reference implementation doesn't implement in-band field errors
        encoder.header.selfDescribingErrors = true; // this reference implementation doesn't implement non-self-describing errors
        // uncomment the following to try out other modes
        // encoder.header.inlineEverything = true
        // encoder.header.selfDescribing = true
        // encoder.header.nullTerminatedStrings = true
        // encoder.header.noDeduplication = true
        // encoder.header.hasUserFlags = true
        const type = encoder.header.selfDescribing ? Wire.DESC : this.typer.rootWireType();
        encoder.jsToArgoWithType(js, type);
        return encoder.getResult();
    }
    argoToJs(bytes) {
        const decoder = new ArgoDecoder(bytes);
        return decoder.argoToJsWithType(this.typer.rootWireType());
    }
}
