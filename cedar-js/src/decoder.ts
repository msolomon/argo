import { ExecutionResult } from 'graphql'
import { Wire } from './wire'
import { Label, LabelKind } from './label'
import { writeFileSync } from 'fs'
import { Buf, BufReadonly, BufRead } from './buf'
import { Path, addPath, pathToArray } from 'graphql/jsutils/Path'
import { jsonify } from './util'

class HeaderReader {
  constructor(readonly buf: BufRead) { }
  read(): void {
    const header = this.buf.read(1) // TODO: support reading actual headers
    if (header[0] != 0) throw 'Expected header byte to be 0, but got ' + header[0]
  }
}

class BlockTracker {
  private blocks: Uint8Array[] = []
  private nextBlockIndex: number = 0

  private _message: BufRead
  get message(): BufRead { return this._message }
  get nextBlock(): BufRead {
    const next = this.blocks[this.nextBlockIndex++]
    return new BufReadonly(next)
  }

  constructor(readonly buf: Buf) {
    do {
      const blockLength = Number(Label.read(buf))
      if (blockLength < 0) throw 'Could not read invalid block length: ' + blockLength
      const block = buf.read(blockLength)
      if (block.length != blockLength) throw 'Could not read block of length ' + blockLength + ', only got ' + block.length + ' bytes. Message is invalid for this query.'
      this.blocks.push(block)
    } while (buf.position < buf.length)

    this._message = new BufReadonly(this.blocks[this.blocks.length - 1])
  }
}

export class CedarDecoder {
  private static utf8 = new TextDecoder()
  private static utf8decode = this.utf8.decode.bind(this.utf8)
  private readers: Map<Wire.BlockKey, Reader<any>> = new Map()
  private headerReader: HeaderReader
  private blockTracker: BlockTracker

  DEBUG = false // set to true to enable tracking of extra information
  tracked: any[] = [] // a detailed log of decoding actions, to assist understanding and debugging
  counts: Map<string, number> = new Map() // counts of decoding actions, to assist understanding and debugging

  track = (path: Path | undefined, msg: string, buf: BufRead, value: any) => {
    if (this.DEBUG) this.tracked.push({ path: pathToArray(path).join('.'), msg, pos: buf.position, value, })
  }

  count = (key: string, amnt: number = 1) => {
    const cnt = this.counts.get(key) || 0
    this.counts.set(key, cnt + amnt)
  }

  constructor(readonly messageBuf: Buf) {
    this.headerReader = new HeaderReader(this.messageBuf)
    this.headerReader.read()
    this.blockTracker = new BlockTracker(this.messageBuf)
  }

  /**
   * Decode the Cedar message, returning the result as an ExecutionResult
   * 
   * @param wt The type of the message, as a Wire.Type
   * @returns The decoded message
   * @throws If the message is invalid for the given type
   */
  cedarToJsWithType(wt: Wire.Type): ExecutionResult {
    let exn: any = null
    let result: any = null
    try {
      result = this.readCedar(this.blockTracker.message, undefined, wt)
    } catch (e) {
      exn = e
    } finally {
      if (this.DEBUG) {
        writeFileSync('/tmp/readlog.json', jsonify(this.tracked))
        console.log('Counts', this.counts)
      }
      if (exn) throw exn
      return result
    }
  }

  readCedar = (buf: BufRead, path: Path | undefined, wt: Wire.Type, block?: Wire.BLOCK): any => {
    this.count(wt.type)
    switch (wt.type) {
      case 'BLOCK':
        this.track(path, 'block', buf, wt.key)
        return this.readCedar(buf, path, wt.of, wt)

      case 'NULLABLE':
        const peekLabel = buf.get()
        if (peekLabel == Label.Null[0]) {
          this.track(path, 'null', buf, null);
          this.count('null')
          buf.incrementPosition()
          return null
        } else if (peekLabel == Label.Absent[0]) {
          this.track(path, 'absent', buf, undefined)
          this.count('absent')
          buf.incrementPosition()
          return undefined
        }

        if (!Wire.isLabeled(wt.of)) {
          const marker = Label.read(buf)
          if (marker != Label.NonNullMarker) {
            this.track(path, 'invalid non-null', buf, marker)
            throw 'invalid non-null ' + marker + '\n' + Wire.print(wt) + '\n' + buf.position + 'at ' + pathToArray(path)
          } {
            this.count('non-null')
            this.track(path, 'non-null', buf, marker)
          }
        } else {
          // buf.resetPosition(positionBefore) // no non-null marker here
        }

        return this.readCedar(buf, path, wt.of)

      case 'RECORD':
        this.track(path, 'record', buf, {})
        const obj: { [key: string]: any } = {}
        for (const { name, type, omittable } of wt.fields) {
          if (Wire.isLabeled(type)) {
            this.count('field: labeled')
          } else if (omittable) {
            this.count('field: omittable')
          } else {
            this.count('field: required')
          }

          if (omittable) {
            const labelPeek = buf.get()
            // const label = Label.read(buf)
            if (labelPeek == Label.Error[0]) { throw 'TODO: handle error' }
            if (!Wire.isLabeled(type) && labelPeek == Label.NonNull[0]) {
              this.track(path, 'non-null', buf, name)
              this.count('non-null field')
              this.count('bytes: non-null')
              buf.incrementPosition()
            }
            if (labelPeek == Label.Absent[0]) {
              // obj[name] = Wire.isLabeled(type) ? null : undefined
              obj[name] = undefined
              this.track(path, 'absent', buf, name)
              this.count('absent field')
              this.count('bytes: absent')

              buf.incrementPosition()
              // if (!Wire.isLabeled(type)) { bump(length) }
              continue
            }
          }

          this.track(path, 'record field', buf, name)
          obj[name] = this.readCedar(buf, addPath(path, name, block?.key), type)
        }
        return obj

      case 'ARRAY': {
        const length = Number(Label.read(buf))
        this.track(path, 'array length', buf, length)
        this.count('bytes: array length', Label.encode(BigInt(length)).length)
        // if (length < 0) return null
        return (new Array(length).fill(undefined).map((_, i) => this.readCedar(buf, addPath(path, i, block?.key), wt.of)))
      }

      case 'BOOLEAN':
        const label = Label.read(buf)
        this.track(path, 'read boolean label', buf, label)
        this.count('bytes: boolean')
        switch (label) {
          case Label.FalseMarker: return false
          case Label.TrueMarker: return true
          default: throw 'invalid boolean label ' + label
        }

      case 'STRING':
      case 'BYTES':
      case 'INT32':
      case 'FLOAT64':
      case 'FIXED':
        if (block?.key == null) { throw 'Programmer error: need block key for ' + Wire.print(wt) }
        const reader = this.getReader(block.key, wt)
        this.track(path, 'reader read by block', buf, block)
        const value = reader.read(buf)
        if (this.DEBUG) {
          switch (wt.type) {
            case 'STRING':
              const utf8 = new TextEncoder()
              const encoded = utf8.encode(value as string)
              this.count('bytes: string length ', Label.encode(BigInt(encoded.length)).length)
              this.count('bytes: string ', encoded.length)
              break
            case 'INT32':
              this.count('bytes: int32', Label.encode(BigInt(value as number)).length)
              break
          }
          this.track(path, 'reader read', buf, value)
        }
        return value

      default:
        throw 'unsupported type ' + wt.type

    }
  }

  read<T>(key: Wire.BlockKey, t: Wire.Type, parent: BufRead): T | null {
    return this.getReader<T>(key, t).read(parent)
  }

  private getReader<T>(key: Wire.BlockKey, t: Wire.Type): Reader<T> {
    let reader = this.readers.get(key)
    if (reader == null) {
      reader = this.makeReader(t)
      this.readers.set(key, reader)
    }
    return reader
  }

  makeReader(t: Wire.Type): Reader<any> {
    switch (t.type) {
      case "STRING":
        return new DeduplicatingLabelReader<string>(this.blockTracker.nextBlock, CedarDecoder.utf8decode)
      case "BYTES":
        return new DeduplicatingLabelReader<Uint8Array>(this.blockTracker.nextBlock, bytes => bytes)
      case "INT32":
        return new UnlabeledVarIntReader(this.blockTracker.nextBlock)
      case "FLOAT64":
        return new FixedSizeReader<number>(
          this.blockTracker.nextBlock,
          bytes => new Float64Array(bytes)[0],
          Float64Array.BYTES_PER_ELEMENT)
      case "FIXED": // TODO: support optional deduping?
        return new FixedSizeReader(this.blockTracker.nextBlock, bytes => bytes, t.length)
      default:
        throw 'Unsupported dedupe type ' + t
    }
  }

}

abstract class Reader<Out> {
  constructor(public buf: BufRead) { }
  abstract read(parent: BufRead): Out
}

class DeduplicatingLabelReader<Out> extends Reader<Out> {
  values: Out[] = []
  constructor(public buf: BufRead, protected fromBytes: (bytes: Uint8Array) => Out) { super(buf) }

  read(parent: BufRead): Out {
    const before = parent.position
    const label = Label.read(parent)

    switch (Label.kind(label)) {
      case LabelKind.Backreference: {
        const value = this.values[Label.labelToOffset(label)]
        if (value == undefined) {
          throw 'Got invalid backreference'
        }
        return value
      }
      case LabelKind.Length:
        const bytes = this.buf.read(Number(label))
        const value = this.fromBytes(bytes)
        this.values.push(value)
        return value
      case LabelKind.Null:
        throw 'Programmer error: Reader cannot handle null labels'
      case LabelKind.Absent: throw 'Programmer error: Reader cannot handle absent labels'
      case LabelKind.Error: throw 'Programmer error: Reader cannot handle error labels'
    }
  }
}

class FixedSizeReader<Out> extends Reader<Out> {
  constructor(public buf: BufRead, protected fromBytes: (bytes: Uint8Array) => Out, readonly byteLength: number) {
    super(buf)
  }

  read(parent: BufRead): Out {
    return this.fromBytes(this.buf.read(this.byteLength))
  }
}

class UnlabeledVarIntReader extends Reader<number> {
  read(parent: BufRead): number {
    return Number(Label.read(this.buf))
  }
}