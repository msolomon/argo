import { Label } from './label'
import { Wire } from './wire'
import { writeFileSync } from 'fs'
import { Buf, BufWrite } from './buf'
import { jsonify } from './util'
import { Path, addPath, pathToArray } from 'graphql/jsutils/Path'

const DEBUG = true

export class CedarEncoder {
  private static utf8 = new TextEncoder()
  private static utf8encode = this.utf8.encode.bind(this.utf8)

  private writers: Map<Wire.BlockKey, BlockWriter<any>> = new Map()
  public tracked: any[] = []

  constructor(readonly buf: Buf = new Buf()) { }

  track = (path: Path | undefined, msg: string, buf: BufWrite, value: any) => {
    if (DEBUG) this.tracked.push({ path: pathToArray(path).join('.'), msg, pos: buf.position, value, })
  }

  log = (msg: string | object) => {
    if (DEBUG) {
      if (typeof msg === 'string') this.tracked.push({ pos: this.buf.position, msg })
      else this.tracked.push({ pos: this.buf.position, ...msg })
    }
  }

  getResult(): Buf {
    const header = this.buildHeader()
    let dataBytesNeeded = 0
    const blockLengthHeaders = new Map()
    const bufLength = Label.encode(BigInt(this.buf.length))

    // calculate how much space we need for block values, which go in a series of blocks at the start
    for (const writer of this.writers.values()) {
      let blockBytesNeeded = 0
      for (const value of writer.valuesAsBytes) {
        blockBytesNeeded += value.length
      }
      const blockLengthHeader = Label.encode(BigInt(blockBytesNeeded))
      blockLengthHeaders.set(writer, blockLengthHeader)
      dataBytesNeeded += blockBytesNeeded // reserve space for data
      dataBytesNeeded += blockLengthHeader.length // reserve space for length header
    }

    const dataLength = header.length + dataBytesNeeded + bufLength.length + this.buf.length
    const buf = new Buf(dataLength)

    // write the header
    buf.write(header)

    // write scalar blocks
    for (const [blockKey, writer] of this.writers.entries()) {
      buf.write(blockLengthHeaders.get(writer)) // write length of block
      for (const value of writer.valuesAsBytes) {
        buf.write(value) // write each value in the block
      }
    }

    // write message length
    buf.write(bufLength)
    // write message data
    buf.writeBuf(this.buf)
    if (buf.length != buf.capacity) throw 'Programmer error: incorrect result length ' + buf.length + ', expected ' + buf.capacity
    return buf
  }

  buildHeader(): Uint8Array {
    // TODO: support non-default flags
    const flags = new Uint8Array(1)
    this.track(undefined, 'flags', this.buf, flags)
    return flags
  }

  makeBlockWriter(t: Wire.Type, dedupe: boolean): BlockWriter<any> {
    switch (t.type) {
      case "STRING":
        if (dedupe) return DeduplicatingBlockWriter.lengthOfBytes(CedarEncoder.utf8encode)
        else return BlockWriter.lengthOfBytes(CedarEncoder.utf8encode)
      case "BYTES":
        if (dedupe) return DeduplicatingBlockWriter.lengthOfBytes(bytes => bytes)
        else return BlockWriter.lengthOfBytes(bytes => bytes)
      case "VARINT":
        if (dedupe) throw 'Unimplemented: deduping  ' + t.type
        return BlockWriter.noLabel(Label.encode)
      case 'FLOAT64':
        if (dedupe) throw 'Unimplemented: deduping ' + t.type
        return BlockWriter.noLabel(v => new Uint8Array(new Float64Array([v])))
      case "FIXED":
        if (dedupe) throw 'Unimplemented: deduping ' + t.type
        return BlockWriter.noLabel(bytes => bytes)
      default:
        throw 'Unsupported dedupe type ' + t
    }
  }

  write<T>(block: Wire.BLOCK, t: Wire.Type, v: T): Label | null {
    const writer = this.getWriter<T>(block, t)
    const label = writer.write(v)
    if (label != null) { this.buf.write(Label.encode(label)) }
    return label
  }

  private getWriter<T>(block: Wire.BLOCK, t: Wire.Type): BlockWriter<T> {
    let writer = this.writers.get(block.key)
    if (writer == null) {
      writer = this.makeBlockWriter(t, block.dedupe)
      this.writers.set(block.key, writer)
    }
    return writer
  }

  jsToCedarWithType(js: any, wt: Wire.Type): void {
    const result = this.writeCedar(undefined, js, wt)
    if (DEBUG) writeFileSync('/tmp/writelog.json', jsonify(this.tracked))
    return result
  }

  private writeCedar = (path: Path | undefined, js: any, wt: Wire.Type, block?: Wire.BLOCK): void => {
    switch (wt.type) {
      case 'NULLABLE':
        if (js == null) {
          this.track(path, 'null', this.buf, Label.Null)
          return this.buf.write(Label.Null)
        }

        if (!Wire.isLabeled(wt.of)) {
          this.track(path, 'non-null', this.buf, Label.NonNull)
          this.buf.write(Label.NonNull)
        }
        return this.writeCedar(path, js, wt.of)
      case 'BLOCK':
        if (block != null) { throw `Was already in block '${block}', unexpected to switch to '${wt.key}'. ${Wire.print(wt)}.` }
        this.track(path, 'block with key', this.buf, wt.key)
        return this.writeCedar(path, js, wt.of, wt)
      case 'RECORD': {
        this.track(path, 'record with num fields', this.buf, wt.fields.length)

        for (const { name, type, omittable } of wt.fields) {
          if (js && name in js && js[name] != null) { // field actually present
            if (omittable && !Wire.isLabeled(type)) {
              this.track(path, 'record field is present but omittable, writing non-null', this.buf, name)
              this.buf.write(Label.NonNull)
            }
            this.writeCedar(addPath(path, name, block?.key), js[name], type)
          } else if (omittable && js && (!(name in js) || js[name] === undefined)) { // field not present, but omittable
            this.track(path, 'record field is absent but omittable, writing Absent', this.buf, name)
            this.buf.write(Label.Absent)
          } else if (Wire.isNULLABLE(type)) {
            this.track(path, 'record field is absent but nullable', this.buf, name)
            this.writeCedar(addPath(path, name, block?.key), js[name], type)
          } else {
            this.track(path, 'record field is absent and not-nullable, error', this.buf, name)
            throw 'Error: record field is absent and not-nullable: ' + path
          }
        }
        return
      }

      case 'ARRAY': {
        this.track(path, 'array', this.buf, js.length)
        if (!Array.isArray(js)) {
          console.log(js, '\n\t', JSON.stringify(js), '\n\t', JSON.stringify(wt), '\n', Wire.print(wt))
          console.log(this.tracked)
          throw `Could not encode non - array as array: ${js} `
        }
        this.buf.write(Label.encode(BigInt(js.length)))
        return js.forEach((v, i) => this.writeCedar(addPath(path, i, block?.key), v, wt.of))
      }

      case 'BOOLEAN':
        this.track(path, 'boolean', this.buf, js)
        return this.buf.write(js ? Label.True : Label.False)

      case 'STRING':
      case 'BYTES':
      case 'VARINT':
      case 'FLOAT64':
      case 'FIXED':
        this.track(path, 'writing with block key', this.buf, block)
        if (block == null) { throw 'Programmer error: need block for ' + Wire.print(wt) }
        const label = this.write(block, wt, js)
        this.track(path, wt.type, this.buf, js)
        this.track(path, 'label', this.buf, label)
        return

      case 'DESC':
        this.track(path, 'self-describing', this.buf, js)
        return this.writeSelfDescribing(path, js)

      default: throw `Unsupported wire type ${wt}`
    }
  }

  writeSelfDescribing = (path: Path | undefined, js: any): void => {
    let type = typeof js
    switch (type) {

      case 'object':
        if (js == null) {
          this.buf.write(Wire.SelfDescribing.Null)
        } else if (Array.isArray(js)) {
          this.buf.write(Wire.SelfDescribing.List)
          this.buf.write(Label.encode(js.length))
          js.forEach((v, i) => this.writeSelfDescribing(addPath(path, i, undefined), v))
        } else { // encode as if it's a regular javascript object
          this.buf.write(Wire.SelfDescribing.Object)
          this.buf.write(Label.encode(Object.keys(js).length))
          Object.entries(js).forEach(([field, v]) => {
            this.write(Wire.SelfDescribing.Blocks.STRING, Wire.STRING, field) // undelimited field name
            this.writeSelfDescribing(addPath(path, field, undefined), v) // field value
          })
        }
        return

      case 'string':
        this.buf.write(Wire.SelfDescribing.String)
        this.write(Wire.SelfDescribing.Blocks.STRING, Wire.STRING, js)
        return

      case 'number':
      case 'bigint':
        if (type == 'bigint' || Number.isInteger(js)) {
          this.buf.write(Wire.SelfDescribing.Int)
          this.write(Wire.SelfDescribing.Blocks.VARINT, Wire.VARINT, js)
        } else {
          this.buf.write(Wire.SelfDescribing.Float)
          this.write(Wire.SelfDescribing.Blocks.FLOAT64, Wire.FLOAT64, js)
        }
        return

      case 'boolean':
        this.buf.write(Wire.SelfDescribing.Boolean)
        this.buf.write(js ? Label.True : Label.False)
        return

      case 'undefined':
        this.buf.write(Wire.SelfDescribing.Absent)
        return

      case 'symbol':
      case 'function':
      default:
        throw `Cannot encode unsupported type ${type} at ${path}`
    }
  }
}

/**
 * BlockWriter writes a value (in bytes) to a value block, and returns a label which should be written to the data stream.
 * It does _not_ write the label to the data stream.
 */
class BlockWriter<In> {
  valuesAsBytes: Uint8Array[] = []
  constructor(
    readonly makeLabel: (v: In, out: Uint8Array) => Label | null,
    readonly valueToBytes: (v: In) => Uint8Array,
  ) { }

  static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): BlockWriter<In> {
    return new BlockWriter<In>((v, bytes) => BigInt(bytes.byteLength), toBytes)
  }

  static noLabel<In>(toBytes: (v: In) => Uint8Array): BlockWriter<In> {
    return new BlockWriter<In>((v, bytes) => null, toBytes)
  }

  write(v: In): Label | null {
    const bytes = this.valueToBytes(v)
    this.valuesAsBytes.push(bytes)
    return this.makeLabel(v, bytes)
  }

  toDeduplicating(): DeduplicatingBlockWriter<In> {
    return new DeduplicatingBlockWriter<In>(this.makeLabel, this.valueToBytes)
  }
}

/**
 * A BlockWriter which deduplicates values, returning backreferences for duplicated values.
 */
class DeduplicatingBlockWriter<In> extends BlockWriter<In> {
  seen: Map<In, Label> = new Map()
  lastId: Label = Label.LowestResevedValue

  static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): DeduplicatingBlockWriter<In> {
    return new DeduplicatingBlockWriter<In>((v, bytes) => BigInt(bytes.byteLength), toBytes)
  }

  private nextId() { return --this.lastId }

  constructor(
    readonly labelForNew: (v: In, out: Uint8Array) => Label | null,
    readonly valueToBytes: (v: In) => Uint8Array,
  ) { super(labelForNew, valueToBytes) }

  labelForValue(v: In): Label | null {
    if (v == null) return Label.NullMarker
    const saved = this.seen.get(v)
    if (saved) return saved
    this.seen.set(v, this.nextId())
    return null
  }

  override write(v: In): Label | null {
    const backref = this.labelForValue(v)
    if (backref != null) return backref
    const bytes = this.valueToBytes(v)
    if (bytes) {
      this.valuesAsBytes.push(bytes)
      return this.labelForNew(v, bytes)
    } else return null
  }

  override toDeduplicating(): DeduplicatingBlockWriter<In> {
    return this
  }
}
