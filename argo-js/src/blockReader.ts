import { BufRead } from './buf'
import { Label, LabelKind } from './label'

/** Reads values out of a compact block of values from a Argo message. */
export abstract class BlockReader<Out> {
  constructor(public buf: BufRead) { }
  abstract read(parent: BufRead): Out | undefined | null
  afterNewRead(): void { }
}

/** A BlockReader for length-prefixed values (with length encoded as a Label) */
export class LabelBlockReader<Out> extends BlockReader<Out> {
  constructor(public buf: BufRead, protected fromBytes: (bytes: Uint8Array) => Out) { super(buf) }

  read(parent: BufRead): Out | undefined | null {
    const label = Label.read(parent)

    switch (Label.kind(label)) {
      case LabelKind.Backreference: throw 'Programmer error: This type must not use backreferences'
      case LabelKind.Length:
        const value = this.fromBytes(this.buf.read(Number(label)))
        this.afterNewRead()
        return value
      case LabelKind.Null: throw 'Programmer error: Reader cannot handle null labels'
      case LabelKind.Absent: throw 'Programmer error: Reader cannot handle absent labels'
      case LabelKind.Error: throw 'Programmer error: Reader cannot handle error labels'
    }
  }
}

/** A deduplicating BlockReader for length-prefixed values (with length encoded as a Label) */
export class DeduplicatingLabelBlockReader<Out> extends BlockReader<Out> {
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
        this.afterNewRead()
        return value
      case LabelKind.Null: throw 'Programmer error: Reader cannot handle null labels'
      case LabelKind.Absent: throw 'Programmer error: Reader cannot handle absent labels'
      case LabelKind.Error: throw 'Programmer error: Reader cannot handle error labels'
    }
  }
}

/** A BlockReader which reads blocks of a known, fixed length  */
export class FixedSizeBlockReader<Out> extends BlockReader<Out> {
  constructor(public buf: BufRead, protected fromBytes: (bytes: Uint8Array) => Out, readonly byteLength: number) {
    super(buf)
  }

  read(parent: BufRead): Out {
    return this.fromBytes(this.buf.read(this.byteLength))
  }
}

/** A BlockReader which reads unprefixed variable-length integers encoded as Labels  */
export class UnlabeledVarIntBlockReader extends BlockReader<number> {
  read(parent: BufRead): number {
    return Number(Label.read(this.buf))
  }
}
