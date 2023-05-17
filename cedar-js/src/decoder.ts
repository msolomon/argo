import { ExecutionResult } from 'graphql'
import { DeduplicatingLabelReader, Reader, UnlabeledVarIntReader, } from './dedup'
import { Wire } from './wire'
import { Label } from './label'
import { writeFileSync } from 'fs'
import { Buf, ReadonlyBuf, BufRead } from './buf'
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
    return new ReadonlyBuf(next)
  }

  constructor(readonly buf: Buf) {
    do {
      const blockLength = Number(Label.read(buf))
      if (blockLength < 0) throw 'Could not read invalid block length: ' + blockLength
      const block = buf.read(blockLength)
      if (block.length != blockLength) throw 'Could not read block of length ' + blockLength + ', only got ' + block.length + ' bytes. Message is invalid for this query.'
      this.blocks.push(block)
    } while (buf.position < buf.length)

    this._message = new ReadonlyBuf(this.blocks[this.blocks.length - 1])
  }
}

export class CedarDecoder {
  private static utf8 = new TextDecoder()
  private static utf8decode = this.utf8.decode.bind(this.utf8)
  private readers: Map<Wire.DedupeKey, Reader<any>> = new Map()
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

  constructor(readonly buf: Buf) {
    this.headerReader = new HeaderReader(this.buf)
    this.headerReader.read()
    this.blockTracker = new BlockTracker(this.buf)
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

  readCedar = (buf: BufRead, path: Path | undefined, wt: Wire.Type, dedupeKey?: Wire.DedupeKey): any => {
    this.count(wt.type)
    switch (wt.type) {
      case 'NULLABLE':
        const peekLabel = buf.get()
        if (peekLabel == Label.Null[0]) {
          this.track(path, 'null', buf, null);
          this.count('null')
          buf.incrementPosition(1)
          return null
        } else if (peekLabel == Label.Absent[0]) {
          this.track(path, 'absent', buf, undefined)
          this.count('absent')
          buf.incrementPosition(1)
          return undefined
        }

        const pos = buf.position
        if (!Wire.isLabeled(wt.of)) {
          const marker = Label.read(buf)
          if (marker != Label.NonNullMarker) {
            this.track(path, 'invalid non-null', buf, marker)
            console.log('memokey', dedupeKey, 'pos', pos)
            throw 'invalid non-null ' + marker + '\n' + Wire.print(wt) + '\n' + buf.position + 'at ' + pathToArray(path)
          } {
            this.count('non-null')
            this.track(path, 'non-null', buf, marker)
          }
        } else {
          // buf.resetPosition(positionBefore) // no non-null marker here
        }

        return this.readCedar(buf, path, wt.of)

      case 'DEDUPE':
        this.track(path, 'dedupe', buf, wt.key)
        return this.readCedar(buf, path, wt.of, wt.key)

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
              this.track(path, 'non-null', this.buf, name)
              this.count('non-null field')
              this.count('bytes: non-null')
              buf.incrementPosition(1)
            }
            if (labelPeek == Label.Absent[0]) {
              // obj[name] = Wire.isLabeled(type) ? null : undefined
              obj[name] = undefined
              this.track(path, 'absent', this.buf, name)
              this.count('absent field')
              this.count('bytes: absent')

              buf.incrementPosition(1)
              // if (!Wire.isLabeled(type)) { bump(length) }
              continue
            }
          }

          this.track(path, 'record field', buf, name)
          obj[name] = this.readCedar(buf, addPath(path, name, dedupeKey), type)
        }
        return obj

      case 'ARRAY': {
        const length = Number(Label.read(buf))
        this.track(path, 'array length', buf, length)
        this.count('bytes: array length', Label.encode(BigInt(length)).length)
        // if (length < 0) return null
        return (new Array(length).fill(undefined).map((_, i) => this.readCedar(buf, addPath(path, i, dedupeKey), wt.of)))
      }
      case 'STRING':
      case 'BYTES':
      case 'INT32':
        const reader = this.getReader(dedupeKey, wt)
        this.track(path, 'reader read by dedupeKey', buf, dedupeKey)
        const value = reader.read(buf)
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
        return value
      case 'BOOLEAN':
        const label = Label.read(buf)
        this.track(path, 'read boolean label', buf, label)
        this.count('bytes: boolean')
        switch (label) {
          case Label.FalseMarker: return false
          case Label.TrueMarker: return true
          default: throw 'invalid boolean label ' + label
        }
      default:
        throw 'unsupported type ' + wt.type

    }

  }

  read<T>(dedupeKey: Wire.DedupeKey | undefined, t: Wire.Type, parent: BufRead): T | null {
    return this.getReader<T>(dedupeKey, t).read(parent)
  }

  private getReader<T>(dedupeKey: Wire.DedupeKey | undefined, t: Wire.Type): Reader<T> {
    if (dedupeKey == null) { throw 'Programmer error: need deduplication key for ' + Wire.print(t) }
    let reader = this.readers.get(dedupeKey)
    if (reader == null) {
      reader = this.makeReader(t)
      this.readers.set(dedupeKey, reader)
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

      // case "ARRAY":
      //   return new DeduplicatingLabelReader<Array<any>>(this.blockTracker.nextBlock, (bytes) => [])
      default:
        throw 'Unsupported dedupe type ' + t
    }
  }

}