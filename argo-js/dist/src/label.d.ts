import { BufRead } from './buf';
/** Describes which category of Label it is */
export declare enum LabelKind {
    Null = 0,
    Absent = 1,
    Error = 2,
    Backreference = 3,
    Length = 4
}
export type Label = bigint;
/**
 * A Label is a signed varible-length integer which encodes a length, a backreference, or a special value.
 * It "labels" a value, indicating how it is encoded or some information about it.
 *
 * For example, for a nullable String, the label is generally one of:
 *   - The special value Null
 *   - The length of the String (the value of which is encoded separately)
 *   - A backreference ID to a previously-encountered String, of which this is a duplicate
 */
export declare namespace Label {
    const typeOf = "bigint";
    const TrueMarker: Label;
    const FalseMarker: Label;
    const NonNullMarker: Label;
    const NullMarker: Label;
    const AbsentMarker: Label;
    const ErrorMarker: Label;
    const LowestResevedValue: Label;
    const Null: Uint8Array;
    const Absent: Uint8Array;
    const Error: Uint8Array;
    const Zero: Uint8Array;
    const NonNull: Uint8Array;
    const False: Uint8Array;
    const True: Uint8Array;
    function kind(label: Label): LabelKind;
    function isNull(label: Label): boolean;
    function isAbsent(label: Label): boolean;
    function isError(label: Label): boolean;
    function isLength(label: Label): boolean;
    function isBackref(label: Label): boolean;
    function encode(label: Label | number): Uint8Array;
    function read(buf: BufRead): bigint;
    /** Converts a Label to an offset in an array of backreferences */
    function labelToOffset(label: Label): number;
}
