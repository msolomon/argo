import { Label, LabelKind } from './label';
/** Reads values out of a compact block of values from a Argo message. */
export class BlockReader {
    buf;
    constructor(buf) {
        this.buf = buf;
    }
    afterNewRead() { }
}
/** A BlockReader for length-prefixed values (with length encoded as a Label) */
export class LabelBlockReader extends BlockReader {
    buf;
    fromBytes;
    constructor(buf, fromBytes) {
        super(buf);
        this.buf = buf;
        this.fromBytes = fromBytes;
    }
    read(parent) {
        const label = Label.read(parent);
        switch (Label.kind(label)) {
            case LabelKind.Backreference: throw 'Programmer error: This type must not use backreferences';
            case LabelKind.Length:
                const value = this.fromBytes(this.buf.read(Number(label)));
                this.afterNewRead();
                return value;
            case LabelKind.Null: throw 'Programmer error: Reader cannot handle null labels';
            case LabelKind.Absent: throw 'Programmer error: Reader cannot handle absent labels';
            case LabelKind.Error: throw 'Programmer error: Reader cannot handle error labels';
        }
    }
}
/** A deduplicating BlockReader for length-prefixed values (with length encoded as a Label) */
export class DeduplicatingLabelBlockReader extends BlockReader {
    buf;
    fromBytes;
    values = [];
    constructor(buf, fromBytes) {
        super(buf);
        this.buf = buf;
        this.fromBytes = fromBytes;
    }
    read(parent) {
        const label = Label.read(parent);
        switch (Label.kind(label)) {
            case LabelKind.Backreference: {
                const value = this.values[Label.labelToOffset(label)];
                if (value == undefined) {
                    throw 'Got invalid backreference';
                }
                return value;
            }
            case LabelKind.Length:
                const bytes = this.buf.read(Number(label));
                const value = this.fromBytes(bytes);
                this.values.push(value);
                this.afterNewRead();
                return value;
            case LabelKind.Null: throw 'Programmer error: Reader cannot handle null labels';
            case LabelKind.Absent: throw 'Programmer error: Reader cannot handle absent labels';
            case LabelKind.Error: throw 'Programmer error: Reader cannot handle error labels';
        }
    }
}
/** A BlockReader which reads blocks of a known, fixed length  */
export class FixedSizeBlockReader extends BlockReader {
    buf;
    fromBytes;
    byteLength;
    constructor(buf, fromBytes, byteLength) {
        super(buf);
        this.buf = buf;
        this.fromBytes = fromBytes;
        this.byteLength = byteLength;
    }
    read(parent) {
        return this.fromBytes(this.buf.read(this.byteLength));
    }
}
/** A BlockReader which reads unprefixed variable-length integers encoded as Labels  */
export class UnlabeledVarIntBlockReader extends BlockReader {
    read(parent) {
        return Number(Label.read(this.buf));
    }
}
