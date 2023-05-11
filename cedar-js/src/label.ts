import * as VarInt from './varint'
import { Buf } from './buf'

export enum LabelKind {
  Null,
  Absent,
  Error,
  Backreference,
  Length,
}

export class Label {
  static NonNullMarker = 0n
  static NullMarker = -1n
  static AbsentMarker = -2n
  static ErrorMarker = -3n
  static LowestResevedValue = this.ErrorMarker

  // static Null = new Uint8Array(varint.encode(this.zzenc(Label.NullMarker)))
  static Null = VarInt.ZigZag.encode(Label.NullMarker)
  static Absent = VarInt.ZigZag.encode(Label.AbsentMarker)
  static Error = VarInt.ZigZag.encode(Label.ErrorMarker)
  static Zero = VarInt.ZigZag.encode(0)
  static NonNull = this.Zero
  static False = this.Zero
  static True = VarInt.ZigZag.encode(1)


  static kind(label: bigint): LabelKind {
    if (label >= 0) return LabelKind.Length
    switch (label) {
      case this.NullMarker: return LabelKind.Null
      case this.AbsentMarker: return LabelKind.Null
      case this.ErrorMarker: return LabelKind.Error
      default: return LabelKind.Backreference
    }
  }

  static isNull(label: bigint): boolean { return label == this.NullMarker }
  static isAbsent(label: bigint): boolean { return label == this.AbsentMarker }
  static isError(label: bigint): boolean { return label == this.ErrorMarker }
  static isLength(label: bigint): boolean { return label >= 0 }
  static isBackref(label: bigint): boolean { return label < this.LowestResevedValue }

  static encode(label: bigint): Uint8Array {
    switch (this.kind(label)) {
      case LabelKind.Length:
      case LabelKind.Backreference: return VarInt.ZigZag.encode(label)
      case LabelKind.Null: return Label.Null
      case LabelKind.Absent: return Label.Absent
      case LabelKind.Error: return Label.Error
    }
  }

  static encodeInto(label: bigint, buf: Buffer, offset: number): number {
    switch (this.kind(label)) {
      case LabelKind.Length:
      case LabelKind.Backreference:
        return VarInt.ZigZag.encodeInto(label, buf, offset)
      case LabelKind.Null:
        buf.set(Label.Null, offset)
        return Label.Null.length
      case LabelKind.Absent:
        buf.set(Label.Absent, offset)
        return Label.Absent.length
      case LabelKind.Error:
        buf.set(Label.Error, offset)
        return Label.Error.length
    }
  }

  static decode(buf: Uint8Array, offset: number) {
    const { result, length } = VarInt.ZigZag.decode(buf, offset)
    return { label: result, length }
  }

  static read(buf: Buf) {
    const { result, length } = VarInt.ZigZag.decode(buf.uint8array, buf.position)
    buf.incrementPosition(length)
    return result
  }

}