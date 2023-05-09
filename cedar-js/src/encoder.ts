import * as VarInt from './varint'
import { BackreferenceWriterTracker, ValueDeduplicator } from './dedup'
import { Label, LabelKind } from './label'
import { Wire } from './wire'
import { BitSet } from './bitset'
import { writeFileSync } from 'fs'
import { encode } from 'punycode'

const DEBUG = true

export class CedarEncoder {
  pos = 0
  private nonNullPos = -1
  private static utf8 = new TextEncoder()

  // tracked: { pos: number, kind: string, value: any, bytes: Uint8Array }[] = []
  tracked: any[] = []
  track = (kind: string, value: any, length: number) => {
    if (DEBUG) this.tracked.push({ pos: this.pos, kind, value, bytes: new Uint8Array(this.byteArray.buffer, this.pos, length) })
  }

  log = (msg: string | object) => {
    if (DEBUG) {
      if (typeof msg === 'string') this.tracked.push({ pos: this.pos, msg })
      else this.tracked.push({ pos: this.pos, ...msg })
    }
  }

  constructor(
    // TODO: fix. "1 MB ought to be enough for anybody"
    readonly byteArray: Uint8Array = new Uint8Array(new ArrayBuffer(1024 * 1024))
  ) {
    const flagsBytes = 1
    const flagValue = 0x0
    this.track('flags', flagValue, flagsBytes)
    byteArray[0] = flagValue // TODO: support non-default flags
    this.bump(flagsBytes)
  }

  getResult(): Uint8Array {
    return new Uint8Array(this.byteArray.buffer, 0, this.pos)
  }

  bump = (numNewBytes: number): number => (
    this.pos += numNewBytes
  )

  maybeRewindToOverwriteNonNull = () => {
    // collapse labels over non-null markers, else we waste ~ 1byte/object
    if (this.pos > 0 && this.nonNullPos == this.pos - 1) { // non-null label is 1 byte long, since it is 0
      // console.log('overwriting non-null marker', this.nonNullPos)
      this.pos--
      this.nonNullPos = -1
    }
  }

  writeBytesRaw = (bytes: ArrayLike<number>): void => {
    this.byteArray.set(bytes, this.pos)
    // console.log(this.pos, bytes)
    if (DEBUG) this.track('bytes', bytes, bytes.length)
    this.bump(bytes.length)
  }

  writeVarInt = (n: bigint | number): void => {
    this.maybeRewindToOverwriteNonNull()
    // console.log('writing', n, 'at', this.pos, VarInt.ZigZag.encode(n))
    if (DEBUG) this.track('varint', n, VarInt.ZigZag.encode(n).length)
    this.bump(VarInt.ZigZag.encodeInto(n, this.byteArray, this.pos))
  }

  writeBytes = (bytes: ArrayLike<number>): void => {
    const posbefore = this.pos
    // console.log('writing bytes', bytes.length, bytes)
    this.writeVarInt(bytes.length)
    this.writeBytesRaw(bytes)
    // console.log('position change:', posbefore, '->', this.pos)
  }

  // writeString = (str: ArrayLike<number>): void => {
  //   const posbefore = this.pos
  //   // console.log('writing bytes', bytes.length, bytes)
  //   this.writeVarInt(bytes.length)
  //   this.writeBytesRaw(bytes)
  //   // console.log('position change:', posbefore, '->', this.pos)

  // }
  writeString = (str: string): void => {
    const bytes = CedarEncoder.utf8.encode(str)
    // this.writeBytes(CedarEncoder.utf8.encode(str))
    this.writeVarInt(bytes.length)
    this.byteArray.set(bytes, this.pos)
    // console.log(this.pos, bytes)
    if (DEBUG) this.track('string', str, bytes.length)
    this.bump(bytes.length)
  }

  writeLabel = (bytes: ArrayLike<number>): void => {
    // this.maybeRewindToOverwriteNonNull()
    this.writeBytesRaw(bytes)
  }

  writeLabelNull = (): void => { this.writeLabel(Label.Null) }
  writeLabelAbsent = (): void => { this.writeLabel(Label.Absent) }
  writeLabelError = (): void => { this.writeLabel(Label.Error) }
  writeLabelTrue = (): void => { this.writeLabel(Label.True) }
  writeLabelZero = (): void => { this.writeLabel(Label.Zero) }
  writeLabelFalse = (): void => { this.writeLabel(Label.False) }
  writeLabelNonNull = (): void => {
    this.writeLabel(Label.NonNull)
    // console.log('non-null pos', this.pos)
    // assert(this.nonNullPos > -1, 'should have been -1', this.nonNullPos)
    // this.nonNullPos = this.pos
  }

  newStringDeduplicator() {
    return new ValueDeduplicator<string>(
      this.writeString,

      (n: bigint | number, v: string): void => {
        // console.log('saw string before', n, v)
        // console.log(Error().stack)
        // console.log(this)
        return this.writeVarInt(n)
      }
    )
  }

  dedupers: Map<Wire.MemoKey, ValueDeduplicator<any>> = new Map()

  dedup(memoKey: Wire.MemoKey | undefined, t: Wire.Type, value: any): void {
    if (Wire.isSTRING(t)) {
      if (memoKey == null) return this.writeString(value)
      let deduper = this.dedupers.get(memoKey)
      if (deduper == null) {
        deduper = this.newStringDeduplicator()
        this.dedupers.set(memoKey, deduper)
      }
      deduper.dedup(value)
    } else {
      throw 'Unsupported dedupe type: ' + t
    }
  }

  // stringDedup = this.newStringDeduplicator()
  // enumDedup = this.newStringDeduplicator()
  // idDedup = this.newStringDeduplicator()
  objectTracker = new BackreferenceWriterTracker<object>()
  listTracker = new BackreferenceWriterTracker<Array<unknown>>()
  bytesDedup = new ValueDeduplicator<Uint8Array>(
    (v: Uint8Array) => this.writeBytes(v),
    this.writeVarInt
  )

  jsToCedarWithType(js: any, wt: Wire.Type, encoder: CedarEncoder): void {
    const writeCedar = ((js: any, wt: Wire.Type, encoder: CedarEncoder, memoKey?: Wire.MemoKey): void => {
      // console.log(wt)
      if (Wire.isNULLABLE(wt)) {
        const t = wt.of
        if (js == null) {
          encoder.log('Writing null marker')
          return encoder.writeLabelNull()
        } else if (Wire.isLabeled(t)) {
          return writeCedar(js, t, encoder)
        } else {
          encoder.log('Writing non-null marker')
          encoder.writeLabelNonNull()
        }
        return writeCedar(js, t, encoder)
      } else if (Wire.isDEDUPE(wt)) {
        writeCedar(js, wt.of, encoder, wt.key)
      } else if (Wire.isRECORD(wt)) {
        // let nullMask = 0n
        // let i = 0
        // for (const { name, type } of wt.fields) {
        //   if (js && name in js && js[name] != null) {
        //   } else if (Wire.isNULLABLE(type)) {
        //     nullMask = BitSet.setBit(nullMask, i)
        //   }
        //   else {
        //     nullMask = BitSet.setBit(nullMask, i)
        //     // TODO: fragments which don't match a given union can return empty here even though it is non-nullable
        //     // this could be fixed up to detect this case, if we distinguished unions from other records
        //     //  console.log(js, wt); console.log(encoder.tracked); throw `Could not extract field ${name}\n\t${Wire.print(wt)}\n\t${JSON.stringify(js)}`
        //   }
        //   i++
        // }
        // encoder.log({ msg: 'Writing null mask', value: BitSet.writeVarBitSet(nullMask) })
        // if (nullMask == 0n) {
        //   encoder.writeLabelZero()
        // } else {
        //   encoder.writeBytes(BitSet.writeVarBitSet(nullMask))
        // }

        for (const { name, type, omittable } of wt.fields) {
          // if (omittable) console.log('@ FOUND OMITTABLE', name, 'in', Wire.print(wt))
          if (js && name in js && js[name] != null) {
            if (omittable && !Wire.isLabeled(type)) {
              this.track('writing omittable: present', name, 0)
              encoder.writeLabelNonNull()
            }
            encoder.log({ msg: 'Writing field', field: name, value: js[name] })
            writeCedar(js[name], type, encoder)
          } else if (omittable && js && (!(name in js) || js[name] === undefined)) {
            this.track('writing omittable: absent', name, 0)
            encoder.writeLabelAbsent()
          } else if (Wire.isNULLABLE(type)) {
            // this.track('writting null for field', name, 0)
            // encoder.log({ msg: 'Field was missing from object, writing NULL', field: name })
            // encoder.writeLabelNull()
            writeCedar(js[name], type, encoder)
          } else {
            // if (omittable) {
            //   this.track('writing omittable: absent', name, 0)
            //   encoder.writeLabelAbsent()
            // }
            this.track('skipping absent field', name, 0)
            throw 'programmer error'
            // encoder.writeLabelAbsent()
            // TODO: fragments which don't match a given union can return empty here even though it is non-nullable
            // this could be fixed up to detect this case, if we distinguished unions from other records
            // console.log(js, wt); console.log(encoder.tracked[encoder.tracked.length - 1]); throw `Could not extract field ${name}\n\t${wt}`
          }
        }
      } else if (Wire.isSTRING(wt)) {
        encoder.log({ msg: 'Writing string', value: js })
        // encoder.writeString(js)
        // encoder.stringDedup.dedup(js)
        encoder.dedup(memoKey, wt, js)
      } else if (Wire.isNULL(wt)) { // write nothing
      } else if (Wire.isBOOLEAN(wt)) {
        encoder.log({ msg: 'Writing boolean', value: js })
        if (js) encoder.writeLabelTrue()
        else encoder.writeLabelFalse()
      } else if (Wire.isINT32(wt)) {
        encoder.log({ msg: 'Writing int32', value: js })
        encoder.writeVarInt(js)
      } else if (Wire.isFLOAT64(wt)) {
        encoder.log({ msg: 'Writing float64', value: js })
        throw 'TODO not yet implemented'
      } else if (Wire.isBYTES(wt)) {
        encoder.log({ msg: 'Writing bytes', value: js })
        encoder.writeBytes(js)
      } else if (Wire.isFIXED(wt)) {
        encoder.log({ msg: 'Writing fixed', length: wt.length, value: js })
        encoder.writeBytesRaw(js) // TODO: check the fixed length
      } else if (Wire.isARRAY(wt)) {
        encoder.log({ msg: 'Writing array', value: js })
        if (!Array.isArray(js)) {
          console.log(js, '\n\t', JSON.stringify(js), '\n\t', JSON.stringify(wt), '\n', Wire.print(wt))
          console.log(encoder.tracked)
          throw `Could not encode non - array as array: ${js} `
        }
        const t = wt.of
        encoder.writeVarInt(js.length)
        js.forEach(v => writeCedar(v, t, encoder))
      } else if (Wire.isVARIANT(wt)) {
        // TODO: variant is only enum, build this in?
        encoder.log({ msg: 'Writing variant', value: js })
        encoder.dedup(memoKey, wt, js)
        // encoder.enumDedup.dedup(js)
      } else {
        console.log("Cannot yet handle wire type", wt)
      }
    })

    const jsonify = (a: any) => JSON.stringify(a, (key, value) =>
      typeof value === 'bigint'
        ? value.toString()
        : value // return everything else unchanged
      , 2)


    const result = writeCedar(js, wt, encoder)
    writeFileSync('/tmp/writelog.json', jsonify(this.tracked))
    // console.log('Read log', this.tracked)
    return result
  }
}