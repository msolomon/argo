import { BitSet } from './bitset'
import { Buf } from './buf'

/**
 * Reads/writes the flags/header for a Argo message and provides access to its values.
 */
export class Header {
  flags: BitSet = 0n
  private _userFlags: BitSet | undefined
  constructor(readonly buf: Buf) {}

  private static InlineEverything = 0
  private static SelfDescribing = 1
  private static OutOfBandFieldErrors = 2
  private static SelfDescribingErrors = 3
  private static NullTerminatedStrings = 4
  private static NoDeduplication = 5
  private static HasUserFlags = 6

  read() {
    this.flags = this.readBitSet()
    if (this.hasUserFlags) this._userFlags = this.readBitSet()
  }

  private readBitSet(): BitSet {
    const bs = BitSet.Var.read(this.buf.uint8array)
    this.buf.incrementPosition(bs.length)
    return bs.bitset
  }

  asUint8Array(): Uint8Array {
    const flags = BitSet.Var.write(this.flags)
    const userFlags = this._userFlags ? BitSet.Var.write(this._userFlags) : null
    if (userFlags) return new Uint8Array(Array.from(flags).concat(Array.from(userFlags)))
    else return new Uint8Array(flags)
  }

  write() {
    this.buf.write(this.asUint8Array())
  }

  private set(flag: number, value: boolean) {
    if (value) this.flags = BitSet.setBit(this.flags, flag)
    else this.flags = BitSet.unsetBit(this.flags, flag)
  }

  private get(flag: number): boolean {
    return BitSet.getBit(this.flags, flag)
  }

  get inlineEverything(): boolean {
    return this.get(Header.InlineEverything)
  }
  set inlineEverything(value: boolean) {
    this.set(Header.InlineEverything, value)
  }

  get selfDescribing(): boolean {
    return this.get(Header.SelfDescribing)
  }
  set selfDescribing(value: boolean) {
    this.set(Header.SelfDescribing, value)
  }

  get outOfBandFieldErrors(): boolean {
    return this.get(Header.OutOfBandFieldErrors)
  }
  set outOfBandFieldErrors(value: boolean) {
    this.set(Header.OutOfBandFieldErrors, value)
  }

  get selfDescribingErrors(): boolean {
    return this.get(Header.SelfDescribingErrors)
  }
  set selfDescribingErrors(value: boolean) {
    this.set(Header.SelfDescribingErrors, value)
  }

  get nullTerminatedStrings(): boolean {
    return this.get(Header.NullTerminatedStrings)
  }
  set nullTerminatedStrings(value: boolean) {
    this.set(Header.NullTerminatedStrings, value)
  }

  get noDeduplication(): boolean {
    return this.get(Header.NoDeduplication)
  }
  set noDeduplication(value: boolean) {
    this.set(Header.NoDeduplication, value)
  }

  get hasUserFlags(): boolean {
    return this.get(Header.HasUserFlags)
  }
  get userFlags(): BitSet | undefined {
    return this._userFlags
  }
  set userFlags(value: BitSet | undefined) {
    this._userFlags = value
    this.set(Header.HasUserFlags, value != undefined)
  }
}
