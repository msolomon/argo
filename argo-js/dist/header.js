import { BitSet } from "./bitset";
/**
 * Reads/writes the flags/header for a Argo message and provides access to its values.
 */
class Header {
    buf;
    flags = 0n;
    userFlags;
    constructor(buf) {
        this.buf = buf;
    }
    static InlineEverything = 0;
    static SelfDescribing = 1;
    static OutOfBandFieldErrors = 2;
    static SelfDescribingErrors = 3;
    static NullTerminatedStrings = 4;
    static NoDeduplication = 5;
    static HasUserFlags = 6;
    read() {
        this.flags = this.readBitSet();
        if (this.hasUserFlags)
            this.userFlags = this.readBitSet();
    }
    readBitSet() {
        const bs = BitSet.Var.read(this.buf.uint8array);
        this.buf.incrementPosition(bs.length);
        return bs.bitset;
    }
    asUint8Array() {
        const flags = BitSet.Var.write(this.flags);
        const userFlags = this.userFlags ? BitSet.Var.write(this.userFlags) : null;
        if (userFlags)
            return new Uint8Array(Array.from(flags).concat(Array.from(userFlags)));
        else
            return new Uint8Array(flags);
    }
    write() {
        this.buf.write(this.asUint8Array());
    }
    set(flag, value) {
        if (value)
            this.flags = BitSet.setBit(this.flags, flag);
        else
            this.flags = BitSet.unsetBit(this.flags, flag);
    }
    get(flag) { return BitSet.getBit(this.flags, flag); }
    get inlineEverything() { return this.get(Header.InlineEverything); }
    set inlineEverything(value) { this.set(Header.InlineEverything, value); }
    get selfDescribing() { return this.get(Header.SelfDescribing); }
    set selfDescribing(value) { this.set(Header.SelfDescribing, value); }
    get outOfBandFieldErrors() { return this.get(Header.OutOfBandFieldErrors); }
    set outOfBandFieldErrors(value) { this.set(Header.OutOfBandFieldErrors, value); }
    get selfDescribingErrors() { return this.get(Header.SelfDescribingErrors); }
    set selfDescribingErrors(value) { this.set(Header.SelfDescribingErrors, value); }
    get nullTerminatedStrings() { return this.get(Header.NullTerminatedStrings); }
    set nullTerminatedStrings(value) { this.set(Header.NullTerminatedStrings, value); }
    get noDeduplication() { return this.get(Header.NoDeduplication); }
    set noDeduplication(value) { this.set(Header.NoDeduplication, value); }
    get hasUserFlags() { return this.get(Header.HasUserFlags); }
    set hasUserFlags(value) { this.set(Header.HasUserFlags, value); }
}
export { Header };
