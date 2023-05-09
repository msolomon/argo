import { GraphQLCompositeType, Kind, visit, GraphQLType, FieldNode, ExecutionResult, ASTNode, OperationTypeNode, ResponsePath, GraphQLTypeResolver, GraphQLFieldResolver, GraphQLAbstractType, DocumentNode, GraphQLResolveInfo, GraphQLSchema, TypedQueryDocumentNode, } from 'graphql'
import * as VarInt from './varint'
import { BackreferenceReaderTracker, BackreferenceWriterTracker, ValueDeduplicator } from './dedup'
import { Typer, Wire } from './wire'
import { Label, LabelKind } from './label'
import { assert } from 'console'
import { writeFileSync } from 'fs'
import { BitSet } from './bitset'

const DEBUG = true

export class CedarDecoder {
  private static utf8 = new TextDecoder()

  // bump = (numNewBytes: number): number => (
  //   this.pos += numNewBytes
  //   // assert(pos < buffer.byteLength, "Ran out of space in buffer")
  // )

  // // tracked: { pos: number, kind: string, value: any, bytes: Uint8Array }[] = []
  // tracked: any[] = []
  // track = (kind: string, value: any, length: number) => {
  //   if (DEBUG) this.tracked.push({ pos: this.pos, kind, value, bytes: new Uint8Array(this.bytes.buffer, this.pos, length) })
  // }

  // log = (msg: string | object) => {
  //   if (DEBUG) {
  //     if (typeof msg === 'string') this.tracked.push({ pos: this.pos, msg })
  //     else this.tracked.push({ pos: this.pos, ...msg })
  //   }
  // }

  constructor(readonly bytes: Uint8Array) { }

  cedarToJsWithType(wt: Wire.Type): ExecutionResult {
    const cedarThis = this
    let pos = 0


    const dedupers: Map<Wire.MemoKey, BackreferenceReaderTracker<any>> = new Map()
    const stringDedup = new BackreferenceReaderTracker<string>()
    const enumDedup = new BackreferenceReaderTracker<string>()
    const idDedup = new BackreferenceReaderTracker<string>()
    const objectTracker = new BackreferenceReaderTracker<object>()
    const listTracker = new BackreferenceReaderTracker<Array<unknown>>()
    const bump = (numNewBytes: number): number => (
      pos += numNewBytes
      // assert(pos < buffer.byteLength, "Ran out of space in buffer")
    )
    // const tracked: { pos: number, kind: string, value: any, bytes: Uint8Array }[] = []
    const tracked: any[] = []
    const counts: Map<string, number> = new Map()
    const count = (key: string, amnt: number = 1) => {
      const cnt = counts.get(key) || 0
      counts.set(key, cnt + amnt)
    }
    const track = (kind: string, value: any, length: number, position: number = pos) => {
      if (DEBUG) {
        // const log = { position, kind, value, bytes: new Uint8Array(this.bytes.buffer, position, length) }
        const cnt = counts.get(kind) || 0
        counts.set(kind, cnt + length)
        const log = { position, kind, value }
        if (value == null) delete log['value']
        tracked.push(log)
      }
    }
    // function log(msg: string, length: number) {
    //   if (DEBUG) tracked.push({ pos, msg, bytes: new Uint8Array(bytes.buffer, pos, length})
    // }

    const readLabel = (): bigint => {
      const { label, length } = Label.decode(this.bytes, pos)
      if (DEBUG) track('label', label, length)
      // tracked.push({ pos, 'trace': new Error().stack })
      // console.log('reading label at', pos, new Uint8Array(bytes.buffer, pos, length), ':', label)
      bump(length)
      return label
    }

    const readBytesRaw = (length: number): Uint8Array => {
      const buf = new Uint8Array(this.bytes.buffer, pos, length)
      // if (DEBUG) track('bytes', null, length)
      bump(length)
      return buf
    }
    const readString = (length: number): string => {
      // const buf = readBytesRaw(length)
      // return cedarThis.utf8decode.decode(buf)
      const buf = new Uint8Array(this.bytes.buffer, pos, length)
      const str = CedarDecoder.utf8.decode(buf)
      if (DEBUG) track('string', str, length)
      bump(length)
      return str
    }

    const dedup = (memoKey: Wire.MemoKey | undefined, t: Wire.Type, label: bigint) => {
      if (Wire.isSTRING(t)) {
        if (memoKey == null) return readString(Number(label))
        let deduper = dedupers.get(memoKey)
        if (deduper == null) {
          deduper = new BackreferenceReaderTracker<string>()
          dedupers.set(memoKey, deduper)
        }
        counts.set(memoKey, (counts.get(memoKey) || 0) + 1)
        return deduper.valueForLabel(label, readString)
      } else {
        throw 'Unsupported dedupe type: ' + t
      }
    }

    // TODO: actually read the flags
    const flags = readBytesRaw(1)
    assert(flags.byteLength == 1, flags[0] == 0)
    if (DEBUG) track('flags', flags, flags.byteLength)

    // console.log(wt)
    const readCedar = (wt: Wire.Type, memoKey?: Wire.MemoKey): any => {
      if (Wire.isNULLABLE(wt)) {
        // if (Wire.isNullMasked(wt.of)) {
        //   // don't discard any bytes
        //   count('nullmasked instead')
        // } else 
        if (this.bytes[pos] == Label.Null[0]) {
          count('marker: null')
          track('NULL', true, 1)
          pos++
          return null
          // } else if (this.bytes[pos] != Label.NonNull[0]) {
          //   track('invalid non-null', Wire.print(wt.of) + " " + this.bytes[pos], 1)
          //   // throw 'invalid non-null ' + this.bytes[pos]
          // } else if (this.bytes[pos] == Label.Absent[0]) {
          //   count('marker: absent')
          //   track('OMITTED', true, 1)
          //   pos++
          //   return undefined
        } else if (!Wire.isLabeled(wt.of)) {
          count('marker: non-null')
          // count('marker: non-null ' + Wire.print(wt.of))
          track('Non-NULL', Wire.print(wt.of) + " " + this.bytes[pos], 1)
          if (this.bytes[pos] != Label.NonNull[0]) {
            track('invalid non-null', Wire.print(wt.of) + " " + this.bytes[pos], 1)
            throw 'invalid non-null ' + this.bytes[pos] + '\n' + Wire.print(wt)
          }
          pos++ // discard non-null marker
        }
        return readCedar(wt.of)
      } else if (Wire.isDEDUPE(wt)) {
        return readCedar(wt.of, wt.key)
      } else if (Wire.isRECORD(wt)) {
        count('records read')
        const posBefore = pos
        // const label = readLabel()
        // if (Label.isError(label)) {
        //   throw 'TODO: handle error'
        // }
        // count('marker: nullmask length', pos - posBefore)
        // const nullMask = label == 0n ? { length: 0, bitset: 0n } : BitSet.readVarBitSet(this.bytes, pos)
        // if (nullMask.length != Number(label)) throw 'length not as expected'
        // bump(nullMask.length)
        // count('marker: nullMask', nullMask.length)
        // track('nullmask', nullMask, pos - posBefore, posBefore)
        let i = 0
        const obj: { [key: string]: any } = {}
        for (const { name, type, omittable } of wt.fields) {
          // if (BitSet.getBit(nullMask.bitset, i)) {
          //   track('skipping null field', name, 0)
          //   obj[name] = null
          // } else {
          track('reading field', name, 0)


          if (omittable) {
            const { label, length } = Label.decode(this.bytes, pos)
            if (Label.isError(label)) { throw 'TODO: handle error' }
            if (!Wire.isLabeled(type) && label == Label.NonNullMarker) bump(length)
            if (Label.isAbsent(label)) {
              track('field omitted', name, 0)
              obj[name] = undefined
              // if (!Wire.isLabeled(type)) { bump(length) }
              bump(length)
              continue
            }
          }

          obj[name] = readCedar(type)
          // }
          i++
        }
        track('RECORD', obj, pos - posBefore, posBefore)
        return obj
      } else if (Wire.isSTRING(wt)) {
        const posBefore = pos
        const label = readLabel()
        if (Label.isError(label)) {
          throw 'TODO: handle error'
        }
        count('marker: string length', pos - posBefore)
        const str = dedup(memoKey, wt, label)
        // console.log('reading', t.name, label, str)
        track('string', str, pos - posBefore)
        return str
      } else if (Wire.isNULL(wt)) { // read nothing
      } else if (Wire.isBOOLEAN(wt)) {
        const { label, length } = Label.decode(this.bytes, pos)
        bump(length)
        if (label == 0n) return false
        else if (label == 1n) return true
        else throw "Badly encoded BOOLEAN: " + label + '\n' + Wire.print(wt) + '\n' + pos
      } else if (Wire.isINT32(wt)) {
        const { label, length } = Label.decode(this.bytes, pos)
        const int = Number(label)
        track('int', int, length)
        bump(length)
        return int
        // } else if (Wire.isFLOAT64(wt)) {
        //   encoder.log({ msg: 'Writing float64', value: js })
        //   throw 'TODO not yet implemented'
        // } else if (Wire.isBYTES(wt)) {
        //   encoder.log({ msg: 'Writing bytes', value: js })
        //   encoder.writeBytes(js)
        // } else if (Wire.isFIXED(wt)) {
        //   encoder.log({ msg: 'Writing fixed', length: wt.length, value: js })
        //   encoder.writeBytesRaw(js) // TODO: check the fixed length
      } else if (Wire.isARRAY(wt)) {
        const posBefore = pos
        const label = readLabel()
        if (Label.isError(label)) {
          throw 'TODO: handle error'
        }
        count('marker: array length', pos - posBefore)
        track('going to read child', wt.of, pos - posBefore, posBefore)
        const readChildren = (length: number) =>
          (new Array(length).fill(undefined).map(() => readCedar(wt.of)))
        const list = listTracker.valueForLabel(label, readChildren)
        track('ARRAY', list, pos - posBefore, posBefore)
        return list
      } else if (Wire.isVARIANT(wt)) {
        // TODO: variant is only enum, build this in?
        const posBefore = pos
        const label = readLabel()
        if (Label.isError(label)) {
          throw 'TODO: handle error'
        }
        const str = enumDedup.valueForLabel(label, readString)
        // console.log('reading', t.name, label, str)
        track('VARIANT', str, pos - posBefore)
        return str
      } else {
        console.log("Cannot yet handle wire type", wt)
      }
    }

    const jsonify = (a: any) => JSON.stringify(a, (key, value) =>
      typeof value === 'bigint'
        ? value.toString()
        : value // return everything else unchanged
      , 2)

    let exn: any = null
    let result: any = null
    try {
      result = readCedar(wt)
    } catch (e) {
      exn = e
    } finally {
      writeFileSync('/tmp/readlog.json', jsonify(tracked))
      // console.log('Read log', tracked)
      console.log('Counts', counts)
      if (exn) throw exn
      return result
    }
  }
}