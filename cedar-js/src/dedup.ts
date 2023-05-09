import { Label, LabelKind } from './label'

export class BackreferenceWriterTracker<T> {
  seen: Map<T, bigint> = new Map()
  lastId: bigint = Label.LowestResevedValue

  private nextId() { return --this.lastId }

  labelForValue(v: T): bigint | null {
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

  valueForLabel(label: bigint, getValue: (number: number) => T): T | null {
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

export class ValueDeduplicator<In, Out = void> {
  backrefs: BackreferenceWriterTracker<In> = new BackreferenceWriterTracker()

  constructor(
    readonly onNew: (v: In) => Out,
    readonly onRepeat: (backref: bigint, v: In) => Out
  ) { }

  dedup(v: In): Out {
    const backref = this.backrefs.labelForValue(v)
    if (backref == null) return this.onNew(v)
    else return this.onRepeat(backref, v)
  }
}