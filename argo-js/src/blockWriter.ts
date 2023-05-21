
import { Label } from './label'
import { BufWrite } from './buf'

/**
 * BlockWriter writes a value (in bytes) to a value block, and returns a label which should be written to the data stream.
 * It does _not_ write the label to the data stream.
 */
export class BlockWriter<In> {
  readonly valuesAsBytes: Uint8Array[] = []

  constructor(
    readonly makeLabel: (v: In, out: Uint8Array) => Label | null,
    readonly valueToBytes: (v: In) => Uint8Array,
  ) { }

  static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): BlockWriter<In> {
    return new BlockWriter<In>((v, bytes) => BigInt(bytes.byteLength), toBytes)
  }

  static noLabel<In>(toBytes: (v: In) => Uint8Array): BlockWriter<In> {
    return new BlockWriter<In>((v, bytes) => null, toBytes)
  }

  write(v: In): Label | null {
    const bytes = this.valueToBytes(v)
    this.valuesAsBytes.push(bytes)
    return this.makeLabel(v, bytes)
  }

  toDeduplicating(): DeduplicatingBlockWriter<In> {
    return new DeduplicatingBlockWriter<In>(this.makeLabel, this.valueToBytes)
  }

  // useful in noBlocks mode
  writeLastToBuf(buf: BufWrite): void {
    const lastValue = this.valuesAsBytes.pop()
    if (lastValue == undefined) throw "writeLastToBuf called on empty BlockWriter"
    buf.write(lastValue)
  }
}

/** A BlockWriter which deduplicates values, returning backreferences for duplicated values. */
export class DeduplicatingBlockWriter<In> extends BlockWriter<In> {
  seen: Map<In, Label> = new Map()
  lastId: Label = Label.LowestResevedValue

  static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): DeduplicatingBlockWriter<In> {
    return new DeduplicatingBlockWriter<In>((v, bytes) => BigInt(bytes.byteLength), toBytes)
  }

  private nextId() { return --this.lastId }

  constructor(
    readonly labelForNew: (v: In, out: Uint8Array) => Label | null,
    readonly valueToBytes: (v: In) => Uint8Array,
  ) { super(labelForNew, valueToBytes) }

  labelForValue(v: In): Label | null {
    if (v == null) return Label.NullMarker
    const saved = this.seen.get(v)
    if (saved) return saved
    this.seen.set(v, this.nextId())
    return null
  }

  override write(v: In): Label | null {
    const backref = this.labelForValue(v)
    if (backref != null) return backref
    const bytes = this.valueToBytes(v)
    if (bytes) {
      this.valuesAsBytes.push(bytes)
      return this.labelForNew(v, bytes)
    } else return null
  }

  override toDeduplicating(): DeduplicatingBlockWriter<In> {
    return this
  }
}
