import { BitSet } from "./bitset";
import { Buf } from "./buf";
/**
 * Reads/writes the flags/header for a Argo message and provides access to its values.
 */
export declare class Header {
    readonly buf: Buf;
    flags: BitSet;
    userFlags: BitSet | undefined;
    constructor(buf: Buf);
    private static InlineEverything;
    private static SelfDescribing;
    private static OutOfBandFieldErrors;
    private static SelfDescribingErrors;
    private static NullTerminatedStrings;
    private static NoDeduplication;
    private static HasUserFlags;
    read(): void;
    private readBitSet;
    asUint8Array(): Uint8Array;
    write(): void;
    private set;
    private get;
    get inlineEverything(): boolean;
    set inlineEverything(value: boolean);
    get selfDescribing(): boolean;
    set selfDescribing(value: boolean);
    get outOfBandFieldErrors(): boolean;
    set outOfBandFieldErrors(value: boolean);
    get selfDescribingErrors(): boolean;
    set selfDescribingErrors(value: boolean);
    get nullTerminatedStrings(): boolean;
    set nullTerminatedStrings(value: boolean);
    get noDeduplication(): boolean;
    set noDeduplication(value: boolean);
    get hasUserFlags(): boolean;
    set hasUserFlags(value: boolean);
}
