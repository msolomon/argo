import { Label } from './label';
/**
 * BlockWriter writes a value (in bytes) to a value block, and returns a label which should be written to the data stream.
 * It does _not_ write the label to the data stream.
 */
export class BlockWriter {
    makeLabel;
    valueToBytes;
    valuesAsBytes = [];
    constructor(makeLabel, valueToBytes) {
        this.makeLabel = makeLabel;
        this.valueToBytes = valueToBytes;
    }
    static lengthOfBytes(toBytes) {
        return new BlockWriter((v, bytes) => BigInt(bytes.byteLength), toBytes);
    }
    static noLabel(toBytes) {
        return new BlockWriter((v, bytes) => null, toBytes);
    }
    afterNewWrite() { }
    write(v) {
        const bytes = this.valueToBytes(v);
        this.valuesAsBytes.push(bytes);
        this.afterNewWrite();
        return this.makeLabel(v, bytes);
    }
    toDeduplicating() {
        return new DeduplicatingBlockWriter(this.makeLabel, this.valueToBytes);
    }
    // useful in noBlocks mode
    writeLastToBuf(buf) {
        const lastValue = this.valuesAsBytes.pop();
        if (lastValue == undefined)
            throw "writeLastToBuf called on empty BlockWriter";
        buf.write(lastValue);
    }
}
/** A BlockWriter which deduplicates values, returning backreferences for duplicated values. */
export class DeduplicatingBlockWriter extends BlockWriter {
    labelForNew;
    valueToBytes;
    seen = new Map();
    lastId = Label.LowestResevedValue;
    static lengthOfBytes(toBytes) {
        return new DeduplicatingBlockWriter((v, bytes) => BigInt(bytes.byteLength), toBytes);
    }
    nextId() { return --this.lastId; }
    constructor(labelForNew, valueToBytes) {
        super(labelForNew, valueToBytes);
        this.labelForNew = labelForNew;
        this.valueToBytes = valueToBytes;
    }
    labelForValue(v) {
        if (v == null)
            return Label.NullMarker;
        const saved = this.seen.get(v);
        if (saved)
            return saved;
        this.seen.set(v, this.nextId());
        return null;
    }
    write(v) {
        const backref = this.labelForValue(v);
        if (backref != null)
            return backref;
        const bytes = this.valueToBytes(v);
        if (bytes) {
            this.valuesAsBytes.push(bytes);
            this.afterNewWrite();
            return this.labelForNew(v, bytes);
        }
        else
            return null;
    }
    toDeduplicating() {
        return this;
    }
}
