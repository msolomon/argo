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
  static adjustIndexBy: number = Number(Label.LowestResevedValue) - 1

  valueForLabel(label: Label, getValue: (number: number) => T): T | null {
    switch (Label.kind(label)) {
      case LabelKind.Absent: return null
      case LabelKind.Null: return null
      case LabelKind.Backreference: {
        const value = this.seen[Number(-label) + BackreferenceReaderTracker.adjustIndexBy]

        if (value == undefined) {
          console.error('@@ ERROR', label, Number(-label) + BackreferenceReaderTracker.adjustIndexBy, value)
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
 * Deduplicates values which will be serialized as bytes.
 * When values repeat, returns backreferences to them instead.
 * 
 * @param onNew Called for side effects when a new value is encountered.
 * @param onRepeat Called for side effects when a value is repeated.
 * @param valueToBytes Converts a value to bytes (invoked once per unique value)
 */
export class ValueDeduplicator<In> {
  valuesAsBytes: Uint8Array[] = []
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

  constructor(
    readonly onNew: (v: In, out: Uint8Array) => void,
    readonly onRepeat: (backref: Label, v: In) => void,
    readonly valueToBytes: (v: In) => Uint8Array,
  ) { }

  dedup(v: In): void {
    const backref = this.labelForValue(v)
    if (backref == null) {
      const bytes = this.valueToBytes(v)
      this.onNew(v, bytes)
    } else {
      this.onRepeat(backref, v)
    }
  }
}