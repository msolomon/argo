import * as VarInt from './varint'
import { Buf } from './buf'

export enum LabelKind {
  Null,
  Absent,
  Error,
  Backreference,
  Length,
}

export type Label = bigint

export namespace Label {
  export const typeOf = 'bigint'
  export const NonNullMarker: Label = 0n
  export const NullMarker: Label = -1n
  export const AbsentMarker: Label = -2n
  export const ErrorMarker: Label = -3n
  export const LowestResevedValue: Label = ErrorMarker

  // export const Null = new Uint8Array(varint.encode(zzenc(NullMarker)))
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
      case AbsentMarker: return LabelKind.Null
      case ErrorMarker: return LabelKind.Error
      default: return LabelKind.Backreference
    }
  }

  export function isNull(label: Label): boolean { return label == NullMarker }
  export function isAbsent(label: Label): boolean { return label == AbsentMarker }
  export function isError(label: Label): boolean { return label == ErrorMarker }
  export function isLength(label: Label): boolean { return label >= 0 }
  export function isBackref(label: Label): boolean { return label < LowestResevedValue }

  export function encode(label: Label): Uint8Array {
    switch (kind(label)) {
      case LabelKind.Length:
      case LabelKind.Backreference: return VarInt.ZigZag.encode(label)
      case LabelKind.Null: return Null
      case LabelKind.Absent: return Absent
      case LabelKind.Error: return Error
    }
  }

  export function encodeInto(label: Label, buf: { [index: number]: number }, offset: number): number {
    switch (kind(label)) {
      case LabelKind.Length:
      case LabelKind.Backreference:
        return VarInt.ZigZag.encodeInto(label, buf, offset)
      case LabelKind.Null:
        buf[offset] = Null[0]
        return Null.length
      case LabelKind.Absent:
        buf[offset] = Absent[0]
        return Absent.length
      case LabelKind.Error:
        buf[offset] = Error[0]
        return Error.length
    }
  }

  export function decode(buf: Uint8Array, offset: number = 0) {
    const { result, length } = VarInt.ZigZag.decode(buf, offset)
    return { label: result, length }
  }

  export function read(buf: Buf) {
    const { result, length } = VarInt.ZigZag.decode(buf.uint8array, buf.position)
    buf.incrementPosition(length)
    return result
  }
}
