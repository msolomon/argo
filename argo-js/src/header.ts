import { BitSet } from "./bitset"
import { Buf } from "./buf"

/**
 * Reads/writes the flags/header for a Argo message and provides access to its values.
 */
export class Header {
  flags: BitSet = 0n
  constructor(readonly buf: Buf) { }

  private static NoBlocks = 0
  private static SelfDescribing = 1
  private static OutOfBandFieldErrors = 2

  read() {
    const bs = BitSet.Var.read(this.buf.uint8array)
    this.buf.incrementPosition(bs.length)
    this.flags = bs.bitset
  }

  asUint8Array(): Uint8Array {
    return new Uint8Array(BitSet.Var.write(this.flags))
  }

  write() {
    this.buf.write(this.asUint8Array())
  }

  private set(flag: number, value: boolean) {
    if (value) this.flags = BitSet.setBit(this.flags, flag)
    else this.flags = BitSet.unsetBit(this.flags, flag)
  }

  private get(flag: number): boolean { return BitSet.getBit(this.flags, flag) }

  get noBlocks(): boolean { return this.get(Header.NoBlocks) }
  set noBlocks(value: boolean) { this.set(Header.NoBlocks, value) }

  get selfDescribing(): boolean { return this.get(Header.SelfDescribing) }
  set selfDescribing(value: boolean) { this.set(Header.SelfDescribing, value) }

  get outOfBandFieldErrors(): boolean { return this.get(Header.OutOfBandFieldErrors) }
  set outOfBandFieldErrors(value: boolean) { this.set(Header.OutOfBandFieldErrors, value) }
}
