import { Wire } from './wire';
import { Label } from './label';
import { writeFileSync } from 'fs';
import { BufReadonly } from './buf';
import { addPath, pathToArray } from 'graphql/jsutils/Path';
import { jsonify } from './util';
import { DeduplicatingLabelBlockReader, FixedSizeBlockReader, LabelBlockReader, UnlabeledVarIntBlockReader } from './blockReader';
import { Header } from './header';
/**
 * Decodes a Argo message into a JavaScript object (ExecutionResult).
 */
class ArgoDecoder {
    messageBuf;
    static utf8 = new TextDecoder();
    static utf8decode = this.utf8.decode.bind(this.utf8);
    readers = new Map();
    slicer;
    DEBUG = false; // set to true to enable tracking of extra information
    tracked = []; // a detailed log of decoding actions, to assist understanding and debugging
    counts = new Map(); // counts of decoding actions, to assist understanding and debugging
    track = (path, msg, buf, value) => {
        if (this.DEBUG)
            this.tracked.push({ path: pathToArray(path).join('.'), msg, pos: buf.position, value, });
    };
    count = (key, amnt = 1) => {
        const cnt = this.counts.get(key) || 0;
        this.counts.set(key, cnt + amnt);
    };
    constructor(messageBuf) {
        this.messageBuf = messageBuf;
        this.slicer = new MessageSlicer(this.messageBuf);
    }
    /**
     * Decode the Argo message, returning the result as an ExecutionResult
     *
     * @param wt The type of the message, as a Wire.Type
     * @returns The decoded message
     * @throws If the message is invalid for the given type
     */
    argoToJsWithType(wt) {
        let exn = null;
        let result = null;
        try {
            result = this.readArgo(this.slicer.core, undefined, this.slicer.header.selfDescribing ? Wire.DESC : wt);
        }
        catch (e) {
            exn = e;
        }
        finally {
            if (this.DEBUG) {
                writeFileSync('/tmp/readlog.json', jsonify(this.tracked));
                console.table(this.counts);
            }
            if (exn)
                throw exn;
            return result;
        }
    }
    readArgo = (buf, path, wt, block) => {
        this.count(wt.type);
        switch (wt.type) {
            case 'BLOCK':
                this.track(path, 'block', buf, { key: wt.key, dedupe: wt.dedupe });
                return this.readArgo(buf, path, wt.of, wt);
            case 'NULLABLE':
                const peekLabel = buf.get();
                if (peekLabel == Label.Null[0]) {
                    this.track(path, 'null', buf, null);
                    this.count('null');
                    buf.incrementPosition();
                    return null;
                }
                else if (peekLabel == Label.Absent[0]) {
                    this.track(path, 'absent', buf, undefined);
                    this.count('absent');
                    buf.incrementPosition();
                    return undefined;
                }
                else if (peekLabel == Label.Error[0]) {
                    this.track(path, 'error', buf, undefined);
                    this.count('error');
                    buf.incrementPosition();
                    const error = this.readSelfDescribing(buf, path);
                    this.track(path, 'error value', buf, undefined);
                    // A different implementation might choose a different behavior, like attaching the error to the result
                    return null; // simple for compatibility, but up to implementations what to do with inline errors 
                }
                if (!Wire.isLabeled(wt.of)) {
                    const marker = Label.read(buf);
                    if (marker != Label.NonNullMarker) {
                        this.track(path, 'invalid non-null', buf, marker);
                        throw 'invalid non-null ' + marker + '\n' + Wire.print(wt) + '\n' + buf.position + 'at ' + pathToArray(path);
                    }
                    {
                        this.count('non-null');
                        this.track(path, 'non-null', buf, marker);
                    }
                }
                else {
                    // buf.resetPosition(positionBefore) // no non-null marker here
                }
                return this.readArgo(buf, path, wt.of);
            case 'RECORD':
                this.track(path, 'record', buf, {});
                const obj = {};
                for (const { name, type, omittable } of wt.fields) {
                    if (Wire.isLabeled(type)) {
                        this.count('field: labeled');
                    }
                    else if (omittable) {
                        this.count('field: omittable');
                    }
                    else {
                        this.count('field: required');
                    }
                    if (omittable) {
                        const labelPeek = buf.get();
                        // const label = Label.read(buf)
                        if (labelPeek == Label.Error[0]) {
                            throw 'TODO: handle error';
                        }
                        if (!Wire.isLabeled(type) && labelPeek == Label.NonNull[0]) {
                            this.track(path, 'non-null', buf, name);
                            this.count('non-null field');
                            this.count('bytes: non-null');
                            buf.incrementPosition();
                        }
                        if (labelPeek == Label.Absent[0]) {
                            obj[name] = undefined;
                            this.track(path, 'absent', buf, name);
                            this.count('absent field');
                            this.count('bytes: absent');
                            buf.incrementPosition();
                            continue;
                        }
                    }
                    this.track(path, 'record field', buf, name);
                    obj[name] = this.readArgo(buf, addPath(path, name, block?.key), type);
                }
                return obj;
            case 'ARRAY': {
                const length = Number(Label.read(buf));
                this.track(path, 'array length', buf, length);
                this.count('bytes: array length', Label.encode(BigInt(length)).length);
                return (new Array(length).fill(undefined).map((_, i) => this.readArgo(buf, addPath(path, i, block?.key), wt.of)));
            }
            case 'BOOLEAN':
                const label = Label.read(buf);
                this.track(path, 'read boolean label', buf, label);
                this.count('bytes: boolean');
                switch (label) {
                    case Label.FalseMarker: return false;
                    case Label.TrueMarker: return true;
                    default: throw 'invalid boolean label ' + label;
                }
            case 'STRING':
            case 'BYTES':
            case 'VARINT':
            case 'FLOAT64':
            case 'FIXED':
                if (block?.key == null) {
                    throw 'Programmer error: need block key for ' + Wire.print(wt);
                }
                const reader = this.getBlockReader(block, wt);
                this.track(path, 'reader read by block', buf, block);
                const value = reader.read(buf);
                if (this.DEBUG) {
                    switch (wt.type) {
                        case 'STRING':
                            const utf8 = new TextEncoder();
                            const encoded = utf8.encode(value);
                            this.count('bytes: string length ', Label.encode(BigInt(encoded.length)).length);
                            this.count('bytes: string ', encoded.length);
                            break;
                        case 'VARINT':
                            this.count('bytes: VARINT', Label.encode(BigInt(value)).length);
                            break;
                    }
                    this.track(path, 'reader read', buf, value);
                }
                return value;
            case 'DESC':
                this.track(path, 'self-describing', buf, {});
                return this.readSelfDescribing(buf, path);
            default: throw `Unsupported wire type ${wt}`;
        }
    };
    readSelfDescribing = (buf, path) => {
        const label = Label.read(buf);
        switch (label) {
            case Wire.SelfDescribing.TypeMarker.Null: return null;
            case Wire.SelfDescribing.TypeMarker.False: return false;
            case Wire.SelfDescribing.TypeMarker.True: return true;
            case Wire.SelfDescribing.TypeMarker.Object: {
                const obj = {};
                const length = Number(Label.read(buf));
                for (let i = 0; i < length; i++) {
                    const fieldPath = addPath(path, i, Wire.TypeKey.STRING);
                    const fieldName = this.readArgo(buf, fieldPath, Wire.STRING, Wire.SelfDescribing.Blocks.STRING);
                    const value = this.readSelfDescribing(buf, addPath(path, i, undefined));
                    obj[fieldName] = value;
                }
                return obj;
            }
            case Wire.SelfDescribing.TypeMarker.List:
                const length = Number(Label.read(buf));
                return new Array(length).fill(undefined)
                    .map((_, i) => this.readSelfDescribing(buf, addPath(path, i, undefined)));
            case Wire.SelfDescribing.TypeMarker.String:
                return this.readArgo(buf, path, Wire.STRING, Wire.SelfDescribing.Blocks.STRING);
            case Wire.SelfDescribing.TypeMarker.Bytes:
                return this.readArgo(buf, path, Wire.BYTES, Wire.SelfDescribing.Blocks.BYTES);
            case Wire.SelfDescribing.TypeMarker.Int:
                return this.readArgo(buf, path, Wire.VARINT, Wire.SelfDescribing.Blocks.VARINT);
            case Wire.SelfDescribing.TypeMarker.Float:
                return this.readArgo(buf, path, Wire.FLOAT64, Wire.SelfDescribing.Blocks.FLOAT64);
            default: throw 'Invalid self-describing type marker: ' + label;
        }
    };
    getBlockReader(block, t) {
        let reader = this.readers.get(block.key);
        if (reader == null) {
            reader = this.makeBlockReader(t, block.dedupe);
            this.readers.set(block.key, reader);
        }
        return reader;
    }
    makeBlockReader(t, dedupe) {
        switch (t.type) {
            case "STRING":
                let reader;
                if (dedupe)
                    reader = new DeduplicatingLabelBlockReader(this.slicer.nextBlock, ArgoDecoder.utf8decode);
                else
                    reader = new LabelBlockReader(this.slicer.nextBlock, ArgoDecoder.utf8decode);
                if (this.slicer.header.nullTerminatedStrings) {
                    reader.afterNewRead = () => reader.buf.incrementPosition(); // skip the null byte
                }
                return reader;
            case "BYTES":
                if (dedupe)
                    return new DeduplicatingLabelBlockReader(this.slicer.nextBlock, bytes => bytes);
                else
                    return new LabelBlockReader(this.slicer.nextBlock, bytes => bytes);
            case "VARINT":
                if (dedupe)
                    throw 'Unimplemented: deduping ' + t.type;
                return new UnlabeledVarIntBlockReader(this.slicer.nextBlock);
            case "FLOAT64":
                if (dedupe)
                    throw 'Unimplemented: deduping ' + t.type;
                return new FixedSizeBlockReader(this.slicer.nextBlock, bytes => new Float64Array(bytes)[0], Float64Array.BYTES_PER_ELEMENT);
            case "FIXED":
                if (dedupe)
                    throw 'Unimplemented: deduping ' + t.type;
                return new FixedSizeBlockReader(this.slicer.nextBlock, bytes => bytes, t.length);
            default:
                throw 'Unsupported block type ' + t;
        }
    }
}
export { ArgoDecoder };
/** Given an entire Argo message, splits apart header, blocks, and core. Makes no copies. */
class MessageSlicer {
    buf;
    blocks = [];
    nextBlockIndex = 0;
    header;
    core;
    get nextBlock() {
        if (this.header.inlineEverything)
            return this.core;
        const next = this.blocks[this.nextBlockIndex++];
        return new BufReadonly(next);
    }
    constructor(buf) {
        this.buf = buf;
        this.header = new Header(buf);
        this.header.read();
        if (this.header.inlineEverything) {
            this.blocks.push(buf.read(buf.length - buf.position)); // read the entire message
        }
        else {
            do {
                const blockLength = Number(Label.read(buf));
                if (blockLength < 0)
                    throw 'Could not read invalid block length: ' + blockLength;
                const block = buf.read(blockLength);
                if (block.length != blockLength)
                    throw 'Could not read block of length ' + blockLength + ', only got ' + block.length + ' bytes. Message is invalid for this Wire schema.';
                this.blocks.push(block);
            } while (buf.position < buf.length);
        }
        this.core = new BufReadonly(this.blocks[this.blocks.length - 1]);
    }
}
