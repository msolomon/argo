import { GraphQLCompositeType, Kind, visit, GraphQLType, FieldNode, ExecutionResult, ASTNode, OperationTypeNode, ResponsePath, GraphQLTypeResolver, GraphQLFieldResolver, GraphQLAbstractType, DocumentNode, GraphQLResolveInfo, GraphQLSchema, TypedQueryDocumentNode, } from 'graphql'
import * as VarInt from './varint'
import { BackreferenceReaderTracker, DeduplicatingLabelReader, FixedSizeReader, Reader, UnlabeledVarIntReader, } from './dedup'
import { Typer, Wire } from './wire'
import { Label, LabelKind } from './label'
import { assert } from 'console'
import { writeFileSync } from 'fs'
import { BitSet } from './bitset'
import { Buf, ReadonlyBuf, BufRead } from './buf'
import { get } from 'http'
import { match } from 'assert'

const DEBUG = true

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

  // bump = (numNewBytes: number): number => (
  //   this.pos += numNewBytes
  //   // assert(pos < buffer.byteLength, "Ran out of space in buffer")
  // )

  // // tracked: { pos: number, kind: string, value: any, bytes: Uint8Array }[] = []
  tracked: any[] = []
  track = (path: (string | number)[], msg: string, buf: BufRead, value: any) => {
    if (DEBUG) this.tracked.push({ path: path.join('.'), msg, pos: buf.position, value, })
  }

  // log = (msg: string | object) => {
  //   if (DEBUG) {
  //     if (typeof msg === 'string') this.tracked.push({ pos: this.pos, msg })
  //     else this.tracked.push({ pos: this.pos, ...msg })
  //   }
  // }

  constructor(readonly buf: Buf) {
    this.headerReader = new HeaderReader(this.buf)
    this.headerReader.read()
    this.blockTracker = new BlockTracker(this.buf)
  }

  counts: Map<string, number> = new Map()
  count = (key: string, amnt: number = 1) => {
    const cnt = this.counts.get(key) || 0
    this.counts.set(key, cnt + amnt)
  }

  cedarToJsWithType(wt: Wire.Type): ExecutionResult {
    const cedarThis = this

    const dedupers: Map<Wire.DedupeKey, BackreferenceReaderTracker<any>> = new Map()
    const stringDedup = new BackreferenceReaderTracker<string>()
    const enumDedup = new BackreferenceReaderTracker<string>()
    const idDedup = new BackreferenceReaderTracker<string>()
    const objectTracker = new BackreferenceReaderTracker<object>()
    const listTracker = new BackreferenceReaderTracker<Array<unknown>>()
    // const tracked: { pos: number, kind: string, value: any, bytes: Uint8Array }[] = []
    // const tracked: any[] = []
    // const track = (kind: string, value: any, length: number, position?: number) => {
    //   if (DEBUG) {
    //     // const log = { position, kind, value, bytes: new Uint8Array(this.bytes.buffer, position, length) }
    //     const cnt = counts.get(kind) || 0
    //     counts.set(kind, cnt + length)
    //     const log = { position: position ?? this.buf.position, kind, value }
    //     if (value == null) delete log['value']
    //     tracked.push(log)
    //   }
    // }
    // function log(msg: string, length: number) {
    //   if (DEBUG) tracked.push({ pos, msg, bytes: new Uint8Array(bytes.buffer, pos, length})
    // }

    // const readLabel = (): bigint => {
    //   const label = Label.read(this.buf)
    //   if (DEBUG) track('label', label, length)
    //   // tracked.push({ pos, 'trace': new Error().stack })
    //   return label
    // }

    // const readBytesRaw = (length: number): Uint8Array => {
    //   // const buf = new Uint8Array(this.buf.buffer, pos, length)
    //   const bytes = this.buf.read(length)
    //   // if (DEBUG) track('bytes', null, length)
    //   return bytes
    // }
    // const readString = (length: number): string => {
    //   // const buf = readBytesRaw(length)
    //   // return cedarThis.utf8decode.decode(buf)
    //   const bytes = this.buf.read(length)
    //   const str = CedarDecoder.utf8.decode(bytes)
    //   // if (DEBUG) track('string', str, length)
    //   return str
    // }

    // const dedup = (memoKey: Wire.DedupeKey | undefined, t: Wire.Type, label: bigint) => {
    //   if (Wire.isSTRING(t)) {
    //     if (memoKey == null) return readString(Number(label))
    //     let deduper = dedupers.get(memoKey)
    //     if (deduper == null) {
    //       deduper = new BackreferenceReaderTracker<string>()
    //       dedupers.set(memoKey, deduper)
    //     }
    //     counts.set(memoKey, (counts.get(memoKey) || 0) + 1)
    //     return deduper.valueForLabel(label, readString)
    //   } else {
    //     throw 'Unsupported dedupe type: ' + t
    //   }
    // }

    // // console.log(wt)
    // const readCedar = (wt: Wire.Type, memoKey?: Wire.DedupeKey): any => {
    //   if (Wire.isNULLABLE(wt)) {
    //     // if (Wire.isNullMasked(wt.of)) {
    //     //   // don't discard any bytes
    //     //   count('nullmasked instead')
    //     // } else 
    //     if (!Wire.isLabeled(wt.of)) {
    //       const marker = readLabel()
    //       if (marker == Label.NullMarker) {
    //         return null
    //       } else if (marker != Label.NonNullMarker) {
    //         console.log('invalid non-null', Wire.print(wt), marker,)
    //         track('invalid non-null', Wire.print(wt.of) + " " + marker, 1)
    //         throw 'invalid non-null ' + marker + '\n' + Wire.print(wt)
    //       }
    //       return readCedar(wt.of)
    //     } else { // this value is labeled, so it might be null or something else
    //       const peek = this.buf.get()
    //       if (peek == Label.Null[0]) {
    //         return null
    //       } // TODO: handle errors
    //     }
    //     return readCedar(wt.of)
    //   } else if (Wire.isDEDUPE(wt)) {
    //     return readCedar(wt.of, wt.key)
    //   } else if (Wire.isRECORD(wt)) {
    //     count('records read')
    //     const posBefore = this.buf.position
    //     // const label = readLabel()
    //     // if (Label.isError(label)) {
    //     //   throw 'TODO: handle error'
    //     // }
    //     // count('marker: nullmask length', pos - posBefore)
    //     // const nullMask = label == 0n ? { length: 0, bitset: 0n } : BitSet.readVarBitSet(this.bytes, pos)
    //     // if (nullMask.length != Number(label)) throw 'length not as expected'
    //     // bump(nullMask.length)
    //     // count('marker: nullMask', nullMask.length)
    //     // track('nullmask', nullMask, pos - posBefore, posBefore)
    //     let i = 0
    //     const obj: { [key: string]: any } = {}
    //     for (const { name, type, omittable } of wt.fields) {
    //       // if (BitSet.getBit(nullMask.bitset, i)) {
    //       //   track('skipping null field', name, 0)
    //       //   obj[name] = null
    //       // } else {
    //       track('reading field', name, 0)


    //       if (omittable) {
    //         const label = Label.read(this.buf)
    //         if (Label.isError(label)) { throw 'TODO: handle error' }
    //         if (!Wire.isLabeled(type) && label == Label.NonNullMarker) this.buf.incrementPosition(length)
    //         if (Label.isAbsent(label)) {
    //           track('field omitted', name, 0)
    //           obj[name] = undefined
    //           // if (!Wire.isLabeled(type)) { bump(length) }
    //           continue
    //         }
    //       }

    //       obj[name] = readCedar(type)
    //       // }
    //       i++
    //     }
    //     track('RECORD', obj, this.buf.position - posBefore, posBefore)
    //     return obj
    //   } else if (Wire.isSTRING(wt)) {
    //     const posBefore = this.buf.position
    //     const label = readLabel()
    //     if (Label.isError(label)) {
    //       throw 'TODO: handle error'
    //     }
    //     count('marker: string length', this.buf.position - posBefore)
    //     const str = dedup(memoKey, wt, label)
    //     // console.log('reading', t.name, label, str)
    //     track('string', str, this.buf.position - posBefore)
    //     return str
    //   } else if (Wire.isNULL(wt)) { // read nothing
    //   } else if (Wire.isBOOLEAN(wt)) {
    //     const label = Label.read(this.buf)
    //     if (label == 0n) return false
    //     else if (label == 1n) return true
    //     else throw "Badly encoded BOOLEAN: " + label + '\n' + Wire.print(wt) + '\n' + this.buf.position
    //   } else if (Wire.isINT32(wt)) {
    //     const label = Label.read(this.buf)
    //     const int = Number(label)
    //     track('int', int, length)
    //     return int
    //     // } else if (Wire.isFLOAT64(wt)) {
    //     //   encoder.log({ msg: 'Writing float64', value: js })
    //     //   throw 'TODO not yet implemented'
    //     // } else if (Wire.isBYTES(wt)) {
    //     //   encoder.log({ msg: 'Writing bytes', value: js })
    //     //   encoder.writeBytes(js)
    //     // } else if (Wire.isFIXED(wt)) {
    //     //   encoder.log({ msg: 'Writing fixed', length: wt.length, value: js })
    //     //   encoder.writeBytesRaw(js) // TODO: check the fixed length
    //   } else if (Wire.isARRAY(wt)) {
    //     const posBefore = this.buf.position
    //     const label = readLabel()
    //     if (Label.isError(label)) {
    //       throw 'TODO: handle error'
    //     }
    //     count('marker: array length', this.buf.position - posBefore)
    //     track('going to read child', wt.of, this.buf.position - posBefore, posBefore)
    //     const readChildren = (length: number) =>
    //       (new Array(length).fill(undefined).map(() => readCedar(wt.of)))
    //     const list = listTracker.valueForLabel(label, readChildren)
    //     track('ARRAY', list, this.buf.position - posBefore, posBefore)
    //     return list
    //   } else if (Wire.isVARIANT(wt)) {
    //     // TODO: variant is only enum, build this in?
    //     const posBefore = this.buf.position
    //     const label = readLabel()
    //     if (Label.isError(label)) {
    //       throw 'TODO: handle error'
    //     }
    //     const str = enumDedup.valueForLabel(label, readString)
    //     // console.log('reading', t.name, label, str)
    //     track('VARIANT', str, this.buf.position - posBefore)
    //     return str
    //   } else {
    //     console.log("Cannot yet handle wire type", wt)
    //   }
    // }

    const jsonify = (a: any) => JSON.stringify(a, (key, value) =>
      typeof value === 'bigint'
        ? value.toString()
        : value // return everything else unchanged
      , 2)

    let exn: any = null
    let result: any = null
    try {
      result = this.readCedar(this.blockTracker.message, [], wt)
    } catch (e) {
      exn = e
    } finally {
      writeFileSync('/tmp/readlog.json', jsonify(this.tracked))
      // console.log('Read log', tracked)
      console.log('Counts', this.counts)
      if (exn) throw exn
      return result
    }
  }

  readCedar = (buf: BufRead, path: (string | number)[], wt: Wire.Type, dedupeKey?: Wire.DedupeKey): any => {
    // console.log('reading type', Wire.print(wt), '{', memoKey, '}')
    this.count(wt.type)
    switch (wt.type) {
      case 'NULLABLE':
        // const positionBefore = buf.position
        // const marker = Label.read(buf)
        const peekLabel = buf.get()
        if (peekLabel == Label.Null[0]) {
          this.track(path, 'null', buf, null)
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
            throw 'invalid non-null ' + marker + '\n' + Wire.print(wt) + '\n' + buf.position + 'at ' + path.join('.')
          } {
            this.count('non-null')
            this.count('non-null ' + wt.of.type)
            this.count('non-null ' + wt.of.type + ' ' + path[path.length - 1])
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

        let anyOmittable = false
        let anyNullMarkable = false
        for (const { name, type, omittable } of wt.fields) {
          if (omittable) { anyOmittable = true }
          if (Wire.isNULLABLE(type) && !Wire.isLabeled(type.of)) { anyNullMarkable = true }
        }

        let omitMask = { length: 0, bitset: 0n }
        let nullMask = { length: 0, bitset: 0n }
        if (anyNullMarkable) {
          nullMask = BitSet.readVarBitSet(buf.uint8array, buf.position)
          this.track(path, 'read null mask', buf, nullMask)
          buf.incrementPosition(nullMask.length)
        }
        if (anyOmittable) {
          omitMask = BitSet.readVarBitSet(buf.uint8array, buf.position)
          this.track(path, 'read omit mask', buf, omitMask)
          buf.incrementPosition(omitMask.length)
        }

        let omitI = -1
        let nullI = -1

        for (const { name, type, omittable } of wt.fields) {
          if (Wire.isLabeled(type)) {
            this.count('field: labeled')
          } else if (omittable) {
            this.count('field: omittable')
          } else {
            this.count('field: required')
          }

          if (omittable) {
            omitI++
            if (BitSet.getBit(omitMask.bitset, omitI)) {
              // field is absent
              this.track(path, 'absent', this.buf, name)
              this.count('absent field')
              this.count('bytes: absent')
              continue
            }
          }
          if (Wire.isNULLABLE(type) && !Wire.isLabeled(type.of)) {
            nullI++
            if (BitSet.getBit(nullMask.bitset, nullI)) {
              // field is null
              this.track(path, 'null', buf, name)
              this.count('null field')
              this.count('bytes: null')
              obj[name] = null
              continue
            }
          }

          this.track(path, 'record field', buf, name)
          obj[name] = this.readCedar(buf, [...path, name], Wire.isNULLABLE(type) && !Wire.isLabeled(type.of) ? type.of : type)
        }
        return obj

      case 'ARRAY': {
        this.track(path, 'array', buf, undefined)
        let t = wt.of
        const length = Number(Label.read(buf))
        const arr = new Array(length).fill(undefined)
        this.track(path, 'array length', buf, length)
        this.count('bytes: array length', Label.encode(BigInt(length)).length)
        if (length > 0 && Wire.isNULLABLE(t) && !Wire.isLabeled(t.of)) {
          t = t.of // unwrap the nullable layer
          // instead of non-null markers for each value, read a bitset to show which are null (if any)
          const bs = BitSet.readVarBitSet(buf.uint8array, buf.position)
          this.count('array bitmask', bs.length)
          this.track(path, 'array null mask ', this.buf, bs)
          buf.incrementPosition(bs.length)

          return (arr.map((_, i) => {
            if (BitSet.getBit(bs.bitset, i)) return null
            else return this.readCedar(buf, [...path, i], t)
          }))
        }

        return (arr.map((_, i) => this.readCedar(buf, [...path, i], t)))
        // if (length < 0) return null
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