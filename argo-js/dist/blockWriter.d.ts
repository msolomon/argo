import { Label } from './label';
import { BufWrite } from './buf';
/**
 * BlockWriter writes a value (in bytes) to a value block, and returns a label which should be written to the data stream.
 * It does _not_ write the label to the data stream.
 */
export declare class BlockWriter<In> {
    readonly makeLabel: (v: In, out: Uint8Array) => Label | null;
    readonly valueToBytes: (v: In) => Uint8Array;
    readonly valuesAsBytes: Uint8Array[];
    constructor(makeLabel: (v: In, out: Uint8Array) => Label | null, valueToBytes: (v: In) => Uint8Array);
    static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): BlockWriter<In>;
    static noLabel<In>(toBytes: (v: In) => Uint8Array): BlockWriter<In>;
    afterNewWrite(): void;
    write(v: In): Label | null;
    toDeduplicating(): DeduplicatingBlockWriter<In>;
    writeLastToBuf(buf: BufWrite): void;
}
/** A BlockWriter which deduplicates values, returning backreferences for duplicated values. */
export declare class DeduplicatingBlockWriter<In> extends BlockWriter<In> {
    readonly labelForNew: (v: In, out: Uint8Array) => Label | null;
    readonly valueToBytes: (v: In) => Uint8Array;
    seen: Map<In, Label>;
    lastId: Label;
    static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): DeduplicatingBlockWriter<In>;
    private nextId;
    constructor(labelForNew: (v: In, out: Uint8Array) => Label | null, valueToBytes: (v: In) => Uint8Array);
    labelForValue(v: In): Label | null;
    write(v: In): Label | null;
    toDeduplicating(): DeduplicatingBlockWriter<In>;
}
