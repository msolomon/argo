import {Label} from './label'
import {Wire} from './wire'
import {writeFileSync} from 'fs'
import {Buf, BufWrite} from './buf'
import {jsonify, uint8ArrayToBase64} from './util'
import {addPath, Path, pathToArray} from 'graphql/jsutils/Path'
import {Header} from './header'
import {BlockWriter, DeduplicatingBlockWriter} from './blockWriter'


/**
 * Encodes a JavaScript object (typically ExecutionResult) into a Argo message.
 */
export class ArgoEncoder {
  private static utf8 = new TextEncoder()
  private static utf8encode = this.utf8.encode.bind(this.utf8)

  private writers: Map<Wire.BlockKey, BlockWriter<any>> = new Map()
  public tracked: any[] = []

  header: Header

  DEBUG = false // set to true to enable tracking of extra information

  constructor(readonly buf: Buf = new Buf()) {
    this.header = new Header(this.buf)
  }

  track = (path: Path | undefined, msg: string, buf: BufWrite, value: any) => {
    if (this.DEBUG) this.tracked.push({ path: pathToArray(path).join('.'), msg, pos: buf.position, value })
  }

  log = (msg: string | object) => {
    if (this.DEBUG) {
      if (typeof msg === 'string') this.tracked.push({ pos: this.buf.position, msg })
      else this.tracked.push({ pos: this.buf.position, ...msg })
    }
  }

  getResult(): Buf {
    const header = this.header.asUint8Array()

    const shouldWriteBlocks = !this.header.inlineEverything

    let dataBytesNeeded = 0
    const blockLengthHeaders = new Map()
    const bufLength = Label.encode(this.buf.length)

    if (shouldWriteBlocks) {
      // calculate how much space we need for block values, which go in a series of blocks at the start
      for (const writer of this.writers.values()) {
        let blockBytesNeeded = 0
        for (const value of writer.valuesAsBytes) {
          blockBytesNeeded += value.length
        }
        const blockLengthHeader = Label.encode(blockBytesNeeded)
        blockLengthHeaders.set(writer, blockLengthHeader)
        dataBytesNeeded += blockBytesNeeded // reserve space for data
        dataBytesNeeded += blockLengthHeader.length // reserve space for length header
      }
    }

    const dataLength = header.length + dataBytesNeeded + (shouldWriteBlocks ? bufLength.length : 0) + this.buf.length
    const buf = new Buf(dataLength)

    // write the header
    buf.write(header)
    this.track(undefined, 'header', buf, uint8ArrayToBase64(header))

    // write scalar blocks
    if (shouldWriteBlocks) {
      for (const [blockKey, writer] of this.writers.entries()) {
        this.track(undefined, "block", buf, blockKey)
        buf.write(blockLengthHeaders.get(writer)) // write length of block
        for (const value of writer.valuesAsBytes) {
          this.track(undefined, "block value", buf, uint8ArrayToBase64(value))
          buf.write(value) // write each value in the block
        }
      }

      // write message length
      this.track(undefined, "core length label", buf, uint8ArrayToBase64(bufLength))
      buf.write(bufLength)
    }

    // write message data
    buf.writeBuf(this.buf)
    this.track(undefined, "core bytes", buf, this.buf.length)
    if (buf.length != buf.capacity) throw 'Programmer error: incorrect result length ' + buf.length + ', expected ' + buf.capacity
    return buf
  }

  private static NullTerminator = new Uint8Array([0])
  makeBlockWriter(t: Wire.Type, dedupe: boolean): BlockWriter<any> {
    switch (t.type) {
      case 'STRING':
        let writer: BlockWriter<string | undefined>
        if (dedupe) writer = DeduplicatingBlockWriter.lengthOfBytes(ArgoEncoder.utf8encode)
        else writer = BlockWriter.lengthOfBytes(ArgoEncoder.utf8encode)
        if (this.header.nullTerminatedStrings) {
          writer.afterNewWrite = () => writer.valuesAsBytes.push(ArgoEncoder.NullTerminator)
        }
        return writer
      case 'BYTES':
        if (dedupe) return DeduplicatingBlockWriter.lengthOfBytes((bytes) => bytes)
        else return BlockWriter.lengthOfBytes((bytes) => bytes)
      case 'VARINT':
        if (dedupe) throw 'Unimplemented: deduping  ' + t.type
        return BlockWriter.noLabel(Label.encode)
      case 'FLOAT64':
        if (dedupe) throw 'Unimplemented: deduping ' + t.type
        return BlockWriter.noLabel<number>((v) => new Uint8Array(new Float64Array([v]).buffer))
      case 'FIXED':
        if (dedupe) throw 'Unimplemented: deduping ' + t.type
        return BlockWriter.noLabel((bytes) => bytes)
      default:
        throw 'Unsupported dedupe type ' + t
    }
  }

  write<T>(block: Wire.BLOCK, t: Wire.Type, v: T): Label | null {
    const writer = this.getWriter<T>(block, t)
    const blockLengthBefore = writer.valuesAsBytes.length
    const label = writer.write(v)
    if (label != null) {
      this.buf.write(Label.encode(label))
    }
    if (this.header.inlineEverything) {
      // write to buf instead of block
      if (writer.valuesAsBytes.length == blockLengthBefore + 1) writer.writeLastToBuf(this.buf)
    }
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

  jsToArgoWithType(js: any, wt: Wire.Type): void {
    const result = this.writeArgo(undefined, js, wt)
    if (this.DEBUG) {
      this.getResult() // trigger the rest of the trace
      writeFileSync('/tmp/writelog.json', jsonify(this.tracked))
    }
    return result
  }

  private writeArgo = (path: Path | undefined, js: any, wt: Wire.Type, block?: Wire.BLOCK): void => {
    switch (wt.type) {
      case 'NULLABLE':
        if (js == null) {
          this.track(path, 'null', this.buf, Label.Null)
          return this.buf.write(Label.Null)
        }

        let errorArray: Error[] = []
        if (js instanceof Error) {
          errorArray = [js]
        } else if (Array.isArray(js) && js.length > 0 && js[0] instanceof Error) {
          errorArray = js
        }
        if (errorArray.length > 0) {
          this.track(path, 'error', this.buf, js)
          this.buf.write(Label.Error)
          this.buf.write(Label.encode(BigInt(errorArray.length)))
          return errorArray.forEach((e) => {
            if (this.header.selfDescribingErrors) this.writeSelfDescribing(path, js)
            else {
              this.writeError(path, e)
            }
          })
        }

        if (!Wire.isLabeled(wt.of)) {
          this.track(path, 'non-null', this.buf, Label.NonNull)
          this.buf.write(Label.NonNull)
        }
        return this.writeArgo(path, js, wt.of)

      case 'BLOCK':
        if (block != null) {
          throw `Was already in block '${block}', unexpected to switch to '${wt.key}'. ${Wire.print(wt)}.`
        }
        this.track(path, 'block with key', this.buf, wt.key)
        return this.writeArgo(path, js, wt.of, wt)

      case 'RECORD': {
        this.track(path, 'record with num fields', this.buf, wt.fields.length)

        for (const { name, of: type, omittable } of wt.fields) {
          if (js && name in js && js[name] != null) {
            // field actually present
            if (omittable && !Wire.isLabeled(type)) {
              this.track(path, 'record field is present but omittable, writing non-null', this.buf, name)
              this.buf.write(Label.NonNull)
            }
            this.writeArgo(addPath(path, name, block?.key), js[name], type)
          } else if (omittable && js && (!(name in js) || js[name] === undefined)) {
            // field not present, but omittable
            this.track(path, 'record field is absent but omittable, writing Absent', this.buf, name)
            this.buf.write(Label.Absent)
          } else if (Wire.isNULLABLE(type)) {
            this.track(path, 'record field is absent but nullable', this.buf, name)
            this.writeArgo(addPath(path, name, block?.key), js[name], type)
          } else if (Wire.isBLOCK(type) && Wire.isDESC(type.of)) {
            this.track(path, 'record field is null but self-describing', this.buf, name)
            this.writeArgo(addPath(path, name, block?.key), js[name], type)
          } else {
            this.track(path, 'record field is absent and not-nullable, error', this.buf, name)
            throw new Error('Error: record field is absent and not-nullable: ' + pathToArray(path))
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
        this.buf.write(Label.encode(js.length))
        return js.forEach((v, i) => this.writeArgo(addPath(path, i, block?.key), v, wt.of))
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
        if (block == null) {
          throw 'Programmer error: need block for ' + Wire.print(wt)
        }
        const label = this.write(block, wt, js)
        this.track(path, wt.type, this.buf, js)
        this.track(path, 'label', this.buf, label)
        return

      case 'DESC':
        this.track(path, 'self-describing', this.buf, js)
        return this.writeSelfDescribing(path, js)

      default:
        throw `Unsupported wire type ${wt}`
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
        } else if (js instanceof Uint8Array) {
          this.buf.write(Wire.SelfDescribing.Bytes)
          this.write(Wire.SelfDescribing.Blocks.BYTES, Wire.BYTES, js)
        } else {
          // encode as if it's a regular javascript object
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
        this.buf.write(js ? Wire.SelfDescribing.True : Wire.SelfDescribing.False)
        return

      case 'undefined':
        this.buf.write(Wire.SelfDescribing.Null)
        return

      case 'symbol':
      case 'function':
      default:
        throw `Cannot encode unsupported type ${type} at ${path}`
    }
  }

  writeError = (path: Path | undefined, error: Error): void => {
    const value = {
      message: error.name + ' ' + error.message,
      location: null, // real implementations will often be able to fill this out
      path: path,
      extensions: {
        stackTrace: error.stack,
      },
    }
    this.writeArgo(path, value, Wire.ERROR)
  }
}
