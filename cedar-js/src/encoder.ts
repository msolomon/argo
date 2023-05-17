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

  private writers: Map<Wire.BlockKey, Writer<any>> = new Map()
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


    /*
    ideas for scalar block layout

    * in main message, Labeled values always correspond to an in-block entry. if length given,
    read next value from corresponding block. if backref, use backref from that block. if null, null.
    * that applies to string, id, bytes, enum, int32 (due to varint encoding EDIT: nope, since they can be negative of course), and array.
    null, bool are always inlined.
    object is always inlined, simply because it avoids so much re-writing at the end and keeps things simple.
    nullable values are ALSO written into blocks--this means null/non-null markers are inlined, but the value is not,DDF
    and this separation makes both halves more compressible.o
    this really just leaves non-null floats (and any future FIXED). these are always inlined.
    custom scalars get their own dedupers, and therefore their own blocks.
    we must create the block when we come across the first non-null value in the message,
    and we don't even know it is present until we arrive at it.
    i.e. all blocks are written in the order they are first encountered in the message and therefore necessary.
    so if we come across a string first, the entire first block will be strings.
    if we then encounter a nullable float, we will create a new block for floats.
    if we then encounter a custom scalar called Foo, we will create a new block for Foo (based on its type)
    */
  }

  buildHeader(): Uint8Array {
    // TODO: support non-default flags
    const flags = new Uint8Array(1)
    this.track(undefined, 'flags', this.buf, flags)
    return flags
  }

  makeWriter(t: Wire.Type): Writer<any> {
    switch (t.type) {
      case "STRING":
        return DeduplicatingWriter.lengthOfBytes(CedarEncoder.utf8encode)
      case "BYTES":
        return DeduplicatingWriter.lengthOfBytes(bytes => bytes)
      case "INT32":
        return Writer.noLabel(Label.encode)
      case 'FLOAT64':
        return Writer.noLabel(v => new Uint8Array(new Float64Array([v])))
      case "FIXED":
        return Writer.noLabel(bytes => bytes)
      default:
        throw 'Unsupported dedupe type ' + t
    }
  }

  write<T>(key: Wire.BlockKey, t: Wire.Type, v: T): Label | null {
    const writer = this.getWriter<T>(key, t)
    const label = writer.write(v)
    if (label != null) { this.buf.write(Label.encode(label)) }
    return label
  }

  private getWriter<T>(key: Wire.BlockKey, t: Wire.Type): Writer<T> {
    let writer = this.writers.get(key)
    if (writer == null) {
      writer = this.makeWriter(t)
      this.writers.set(key, writer)
    }
    return writer
  }

  jsToCedarWithType(js: any, wt: Wire.Type): void {
    const result = this.writeCedar(undefined, js, wt)
    if (DEBUG) writeFileSync('/tmp/writelog.json', jsonify(this.tracked))
    return result
  }

  /*
  examples:
  string: write length to msg, then bytes to value block
  int32: write nothing to msg, write zigzag varint to value block
  int32?: write non-null marker to msg, then zigzag varint to value block
  float64: write nothing to msg, then 8 bytes to value block
  float64?: write non-null marker to msg, then 8 bytes to value block
  [string?]: write array length to msg, then length of each entry to msg, then bytes for each entry to value block
  [string!]: write array length to msg, then length of each entry to msg, then bytes for each entry to value block
  [int32?]: write array length to msg, then non-null marker for each entry to msg, then zigzag for each entry to value block
  [int32!]: write array length to msg, then zigzag for each entry to value block
  */

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
      case 'INT32':
      case 'FLOAT64':
      case 'FIXED':
        this.track(path, 'writing with block key', this.buf, block)
        if (block?.key == null) { throw 'Programmer error: need block key for ' + Wire.print(wt) }
        const label = this.write(block.key, wt, js)
        this.track(path, wt.type, this.buf, js)
        this.track(path, 'label', this.buf, label)
        return

      default: throw `Cannot yet handle wire type ${wt}`
    }
  }
}

/**
 * Writer writes a value (in bytes) to a value block, and returns a label which should be written to the data stream.
 * It does _not_ write the label to the data stream.
 */
class Writer<In> {
  valuesAsBytes: Uint8Array[] = []
  constructor(
    readonly makeLabel: (v: In, out: Uint8Array) => Label | null,
    readonly valueToBytes: (v: In) => Uint8Array,
  ) { }

  static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): Writer<In> {
    return new Writer<In>((v, bytes) => BigInt(bytes.byteLength), toBytes)
  }

  static noLabel<In>(toBytes: (v: In) => Uint8Array): Writer<In> {
    return new Writer<In>((v, bytes) => null, toBytes)
  }

  write(v: In): Label | null {
    const bytes = this.valueToBytes(v)
    this.valuesAsBytes.push(bytes)
    return this.makeLabel(v, bytes)
  }

  toDeduplicating(): DeduplicatingWriter<In> {
    return new DeduplicatingWriter<In>(this.makeLabel, this.valueToBytes)
  }
}

/**
 * A Writer which deduplicates values, returning backreferences for duplicated values.
 */
class DeduplicatingWriter<In> extends Writer<In> {
  seen: Map<In, Label> = new Map()
  lastId: Label = Label.LowestResevedValue

  static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): DeduplicatingWriter<In> {
    return new DeduplicatingWriter<In>((v, bytes) => BigInt(bytes.byteLength), toBytes)
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

  override toDeduplicating(): DeduplicatingWriter<In> {
    return this
  }
}
