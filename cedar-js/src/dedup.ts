import { BufRead, ReadonlyBuf } from './buf'
import { Label, LabelKind } from './label'

export class BackreferenceWriterTracker<In> {
  seen: Map<In, Label> = new Map()
  lastId: Label = Label.LowestResevedValue

  private nextId() { return --this.lastId }

  labelForValue(v: In): Label | null {
    if (v == null) return Label.NullMarker
    const saved = this.seen.get(v)
    if (saved) return saved
    this.seen.set(v, this.nextId())
    return null
  }
}

export class BackreferenceReaderTracker<T> {
  seen: T[] = []

  valueForLabel(label: Label, getValue: (number: number) => T): T | null {
    switch (Label.kind(label)) {
      case LabelKind.Absent: return null
      case LabelKind.Null: return null
      case LabelKind.Backreference: {
        const value = this.seen[Label.labelToOffset(label)]

        if (value == undefined) {
          console.error('@@ ERROR', label, Label.labelToOffset(label), value)
          throw '@@ ERROR with backrefs'
        }
        return value
      }
      case LabelKind.Length:
        const value = getValue(Number(label))
        this.seen.push(value)
        return value
      case LabelKind.Error:
        throw 'Programmer error: BackreferenceReaderTracker cannot handle errors'
    }
  }
}


/**
 * Writer writes a value to a value block, and returns a label which should be written to the data stream.
 */
export abstract class Writer<In> {
  valuesAsBytes: Uint8Array[] = []
  abstract write(v: In): Label | null
}

export class BytesWriter<In> extends Writer<In> {
  constructor(
    readonly makeLabel: (v: In, out: Uint8Array) => Label | null,
    readonly valueToBytes: (v: In) => Uint8Array,
  ) { super() }

  static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): BytesWriter<In> {
    return new BytesWriter<In>((v, bytes) => BigInt(bytes.length), toBytes)
  }

  static noLabel<In>(toBytes: (v: In) => Uint8Array): BytesWriter<In> {
    return new BytesWriter<In>((v, bytes) => null, toBytes)
  }

  override write(v: In): Label | null {
    const bytes = this.valueToBytes(v)
    this.valuesAsBytes.push(bytes)
    return this.makeLabel(v, bytes)
  }
}

export class DeduplicatingWriter<In> extends Writer<In> {
  seen: Map<In, Label> = new Map()
  lastId: Label = Label.LowestResevedValue

  static lengthOfBytes<In>(toBytes: (v: In) => Uint8Array): DeduplicatingWriter<In> {
    return new DeduplicatingWriter<In>((v, bytes) => BigInt(bytes.byteLength), toBytes)
  }

  private nextId() { return --this.lastId }

  labelForValue(v: In): Label | null {
    if (v == null) return Label.NullMarker
    const saved = this.seen.get(v)
    if (saved) return saved
    this.seen.set(v, this.nextId())
    return null
  }

  constructor(
    readonly labelForNew: (v: In, out: Uint8Array) => Label,
    readonly valueToBytes: (v: In) => Uint8Array | null,
  ) { super() }

  override write(v: In): Label | null {
    const backref = this.labelForValue(v)
    if (backref != null) return backref
    const bytes = this.valueToBytes(v)
    if (bytes) {
      this.valuesAsBytes.push(bytes)
      return this.labelForNew(v, bytes)
    } else return null
  }

}

/**
 * Writer writes a value to a value block, and returns a label which should be written to the data stream.
 */
export abstract class Reader<Out> {
  constructor(public buf: BufRead) { }
  abstract read(parent: BufRead): Out
}

export class DeduplicatingLabelReader<Out> extends Reader<Out> {
  values: Out[] = []
  constructor(public buf: BufRead, protected fromBytes: (bytes: Uint8Array) => Out) { super(buf) }

  read(parent: BufRead): Out {
    const label = Label.read(parent)

    switch (Label.kind(label)) {
      case LabelKind.Backreference: {
        const value = this.values[Label.labelToOffset(label)]
        if (value == undefined) {
          throw 'Got invalid backreference'
        }
        return value
      }
      case LabelKind.Length:
        const bytes = this.buf.read(Number(label))
        const value = this.fromBytes(bytes)
        this.values.push(value)
        return value
      case LabelKind.Null:
        throw 'Programmer error: Reader cannot handle null labels'
      case LabelKind.Absent: throw 'Programmer error: Reader cannot handle absent labels'
      case LabelKind.Error: throw 'Programmer error: Reader cannot handle error labels'
    }
  }
}

export class FixedSizeReader<Out> extends Reader<Out> {
  constructor(public buf: BufRead, protected fromBytes: (bytes: Uint8Array) => Out, readonly byteLength: number) {
    super(buf)
  }

  read(parent: BufRead): Out {
    return this.fromBytes(this.buf.read(this.byteLength))
  }
}

export class UnlabeledLabelReader extends Reader<Label> {
  read(parent: BufRead): Label {
    return Label.read(this.buf)
  }
}

export class UnlabeledVarIntReader extends Reader<number> {
  read(parent: BufRead): number {
    return Number(Label.read(this.buf))
  }
}