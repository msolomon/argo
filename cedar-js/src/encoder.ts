import * as VarInt from './varint'
import { BytesWriter, DeduplicatingWriter, Writer } from './dedup'
import { Label } from './label'
import { Wire } from './wire'
import { writeFileSync } from 'fs'
import { Buf, BufWrite } from './buf'
import { jsonify } from './util'
import { Path } from 'graphql/jsutils/Path'

const DEBUG = true

export class CedarEncoder {
  private static utf8 = new TextEncoder()
  private static utf8encode = this.utf8.encode.bind(this.utf8)

  private writers: Map<Wire.DedupeKey, Writer<any>> = new Map()
  public tracked: any[] = []

  constructor(readonly buf: Buf = new Buf()) { }

  track = (path: (string | number)[], msg: string, buf: BufWrite, value: any) => {
    if (DEBUG) this.tracked.push({ path: path.join('.'), msg, pos: buf.position, value, })
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
    const deduperLengthHeaders = new Map()
    const bufLength = Label.encode(BigInt(this.buf.length))

    // calculate how much space we need for block values, which go in a series of blocks at the start
    for (const writer of this.writers.values()) {
      let deduperBytesNeeded = 0
      for (const value of writer.valuesAsBytes) {
        deduperBytesNeeded += value.length
      }
      const deduperLengthHeader = Label.encode(BigInt(deduperBytesNeeded))
      deduperLengthHeaders.set(writer, deduperLengthHeader)
      dataBytesNeeded += deduperBytesNeeded // reserve space for data
      dataBytesNeeded += deduperLengthHeader.length // reserve space for length header
    }

    const dataLength = header.length + dataBytesNeeded + bufLength.length + this.buf.length
    const buf = new Buf(dataLength)

    // write the header
    buf.write(header)

    // write scalar blocks
    for (const [dedupeKey, deduper] of this.writers.entries()) {
      buf.write(deduperLengthHeaders.get(deduper)) // write length of block
      for (const value of deduper.valuesAsBytes) {
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
    this.track(['<flags header>'], 'flags', this.buf, flags)
    return flags
  }

  writeBytesRaw = (bytes: ArrayLike<number>): void => {
    this.buf.write(bytes)
  }

  makeWriter(t: Wire.Type): Writer<any> {
    switch (t.type) {
      case "STRING":
        return DeduplicatingWriter.lengthOfBytes(CedarEncoder.utf8encode)
      case "BYTES":
        return DeduplicatingWriter.lengthOfBytes(bytes => bytes)
      case "INT32":
        return BytesWriter.noLabel(Label.encode)
      default:
        throw 'Unsupported dedupe type ' + t
    }
  }

  write<T>(dedupeKey: Wire.DedupeKey | undefined, t: Wire.Type, v: T): Label | null {
    const writer = this.getWriter<T>(dedupeKey, t)
    const label = writer.write(v)
    if (label != null) { this.buf.write(Label.encode(label)) }
    return label
  }

  private getWriter<T>(dedupeKey: Wire.DedupeKey | undefined, t: Wire.Type): Writer<T> {
    if (dedupeKey == null) { throw 'Programmer error: need deduplication key for ' + Wire.print(t) }
    let writer = this.writers.get(dedupeKey)
    if (writer == null) {
      writer = this.makeWriter(t)
      this.writers.set(dedupeKey, writer)
    }
    return writer
  }

  jsToCedarWithType(js: any, wt: Wire.Type): void {


    const result = this.writeCedar([], js, wt)
    writeFileSync('/tmp/writelog.json', jsonify(this.tracked))
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

  private writeCedar = (path: (string | number)[], js: any, wt: Wire.Type, dedupeKey?: Wire.DedupeKey): void => {
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
      case 'DEDUPE':
        if (dedupeKey != null) { throw `Was already deduping '${dedupeKey}', unexpected to switch to '${wt.key}'. ${Wire.print(wt)}.` }
        this.track(path, 'dedupe with key', this.buf, wt.key)
        return this.writeCedar(path, js, wt.of, wt.key)
      case 'RECORD': {
        this.track(path, 'record with num fields', this.buf, wt.fields.length)

        for (const { name, type, omittable } of wt.fields) {
          if (js && name in js && js[name] != null) { // field actually present
            if (omittable && !Wire.isLabeled(type)) {
              this.track(path, 'record field is present but omittable, writing non-null', this.buf, name)
              this.buf.write(Label.NonNull)
            }
            this.writeCedar([...path, name], js[name], type)
          } else if (omittable && js && (!(name in js) || js[name] === undefined)) { // field not present, but omittable
            this.track(path, 'record field is absent but omittable, writing Absent', this.buf, name)
            this.buf.write(Label.Absent)
          } else if (Wire.isNULLABLE(type)) {
            this.track(path, 'record field is absent but nullable', this.buf, name)
            this.writeCedar([...path, name], js[name], type)
          } else {
            this.track(path, 'record field is absent and not-nullable, error', this.buf, name)
            throw 'Error: record field is absent and not-nullable: ' + path
            // TODO: fragments which don't match a given union can return empty here even though it is non-nullable
            // this could be fixed up to detect this case, if we distinguished unions from other records
            // console.log(js, wt); console.log(encoder.tracked[encoder.tracked.length - 1]); throw `Could not extract field ${name}\n\t${wt}`
          }
        }
        return
      }
      case 'STRING':
      case 'BYTES':
      case 'INT32':
        this.track(path, wt.type, this.buf, js)
        this.track(path, 'using dedupe key', this.buf, dedupeKey)
        const label = this.write(dedupeKey, wt, js)
        this.track(path, 'label', this.buf, label)
        return
      case 'NULL':
        this.track(path, 'null, writing nothing', this.buf, null)
        return // write nothing
      case 'BOOLEAN':
        this.track(path, 'boolean', this.buf, js)
        return this.buf.write(js ? Label.True : Label.False)
      case 'FLOAT64':
        this.track(path, 'float64', this.buf, js)
        throw 'TODO not yet implemented'
      case 'FIXED':
        this.track(path, 'fixed', this.buf, js)
        return this.buf.write(js) // TODO: check the fixed length
      case 'ARRAY': {
        this.track(path, 'array', this.buf, js.length)
        if (!Array.isArray(js)) {
          console.log(js, '\n\t', JSON.stringify(js), '\n\t', JSON.stringify(wt), '\n', Wire.print(wt))
          console.log(this.tracked)
          throw `Could not encode non - array as array: ${js} `
        }
        // Label.encodeInto(BigInt(js.length), this.buf)
        this.buf.write(Label.encode(BigInt(js.length)))
        return js.forEach((v, i) => this.writeCedar([...path, i], v, wt.of))
      }
      default: throw `Cannot yet handle wire type ${wt}`
    }
  }
}