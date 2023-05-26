import { BufRead } from './buf';
/** Reads values out of a compact block of values from a Argo message. */
export declare abstract class BlockReader<Out> {
    buf: BufRead;
    constructor(buf: BufRead);
    abstract read(parent: BufRead): Out | undefined | null;
    afterNewRead(): void;
}
/** A BlockReader for length-prefixed values (with length encoded as a Label) */
export declare class LabelBlockReader<Out> extends BlockReader<Out> {
    buf: BufRead;
    protected fromBytes: (bytes: Uint8Array) => Out;
    constructor(buf: BufRead, fromBytes: (bytes: Uint8Array) => Out);
    read(parent: BufRead): Out | undefined | null;
}
/** A deduplicating BlockReader for length-prefixed values (with length encoded as a Label) */
export declare class DeduplicatingLabelBlockReader<Out> extends BlockReader<Out> {
    buf: BufRead;
    protected fromBytes: (bytes: Uint8Array) => Out;
    values: Out[];
    constructor(buf: BufRead, fromBytes: (bytes: Uint8Array) => Out);
    read(parent: BufRead): Out;
}
/** A BlockReader which reads blocks of a known, fixed length  */
export declare class FixedSizeBlockReader<Out> extends BlockReader<Out> {
    buf: BufRead;
    protected fromBytes: (bytes: Uint8Array) => Out;
    readonly byteLength: number;
    constructor(buf: BufRead, fromBytes: (bytes: Uint8Array) => Out, byteLength: number);
    read(parent: BufRead): Out;
}
/** A BlockReader which reads unprefixed variable-length integers encoded as Labels  */
export declare class UnlabeledVarIntBlockReader extends BlockReader<number> {
    read(parent: BufRead): number;
}
