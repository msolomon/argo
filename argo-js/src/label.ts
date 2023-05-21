import * as VarInt from './varInt'
import { BufRead } from './buf'

/** Describes which category of Label it is */
export enum LabelKind {
  Null, // a missing value
  Absent, // a missing value, which should be omitted entirely (e.g. the field or array entry should be dropped)
  Error, // a field error occurred here
  Backreference, // a reference to a previously-encountered value
  Length, // the length of the value
}

export type Label = bigint

/**
 * A Label is a signed varible-length integer which encodes a length, a backreference, or a special value.
 * It "labels" a value, indicating how it is encoded or some information about it.
 * 
 * For example, for a nullable String, the label is generally one of:
 *   - The special value Null
 *   - The length of the String (the value of which is encoded separately)
 *   - A backreference ID to a previously-encountered String, of which this is a duplicate
 */
export namespace Label {
  export const typeOf = 'bigint'
  export const TrueMarker: Label = 1n
  export const FalseMarker: Label = 0n
  export const NonNullMarker: Label = 0n
  export const NullMarker: Label = -1n
  export const AbsentMarker: Label = -2n
  export const ErrorMarker: Label = -3n
  export const LowestResevedValue: Label = ErrorMarker

  export const Null = VarInt.ZigZag.encode(NullMarker)
  export const Absent = VarInt.ZigZag.encode(AbsentMarker)
  export const Error = VarInt.ZigZag.encode(ErrorMarker)
  export const Zero = VarInt.ZigZag.encode(0)
  export const NonNull = Zero
  export const False = Zero
  export const True = VarInt.ZigZag.encode(1)

  export function kind(label: Label): LabelKind {
    if (label >= 0) return LabelKind.Length
    switch (label) {
      case NullMarker: return LabelKind.Null
      case AbsentMarker: return LabelKind.Absent
      case ErrorMarker: return LabelKind.Error
      default: return LabelKind.Backreference
    }
  }

  export function isNull(label: Label): boolean { return label == NullMarker }
  export function isAbsent(label: Label): boolean { return label == AbsentMarker }
  export function isError(label: Label): boolean { return label == ErrorMarker }
  export function isLength(label: Label): boolean { return label >= 0 }
  export function isBackref(label: Label): boolean { return label < LowestResevedValue }

  export function encode(label: Label | number): Uint8Array {
    switch (kind(BigInt(label))) {
      case LabelKind.Length:
      case LabelKind.Backreference: return VarInt.ZigZag.encode(label)
      case LabelKind.Null: return Null
      case LabelKind.Absent: return Absent
      case LabelKind.Error: return Error
    }
  }

  export function read(buf: BufRead) {
    const label = VarInt.ZigZag.decode(buf.uint8array, buf.position)
    buf.position += label.length
    return label.result
  }

  const labelToOffsetFactor = Number(LowestResevedValue) - 1
  /** Converts a Label to an offset in an array of backreferences */
  export function labelToOffset(label: Label): number {
    if (label >= 0) throw 'Cannot convert non-negative label to offset'
    return -Number(label) + labelToOffsetFactor
  }
}
