
import { Label } from './label'

/** Argo Wire encoding */
export namespace Wire {

  /** All possible types of a value */
  export type Type =
    | Wire.STRING
    | Wire.BOOLEAN
    | Wire.VARINT
    | Wire.FLOAT64
    | Wire.BYTES
    | Wire.FIXED
    | Wire.BLOCK
    | Wire.ARRAY
    | Wire.NULLABLE
    | Wire.RECORD
    | Wire.DESC

  export type BlockKey = string

  /** The names of a value */
  export enum TypeKey {
    // Primitive types
    STRING = "STRING",
    BOOLEAN = "BOOLEAN",
    VARINT = "VARINT",
    FLOAT64 = "FLOAT64",
    BYTES = "BYTES",

    // Compound types
    FIXED = "FIXED",
    BLOCK = "BLOCK",
    NULLABLE = "NULLABLE",
    ARRAY = "ARRAY",
    RECORD = "RECORD",
    DESC = "DESC", // a self-describing value
  }

  export type STRING = { type: TypeKey.STRING }
  export type BOOLEAN = { type: TypeKey.BOOLEAN }
  export type VARINT = { type: TypeKey.VARINT }
  export type FLOAT64 = { type: TypeKey.FLOAT64 }
  export type BYTES = { type: TypeKey.BYTES }
  export const STRING: Wire.STRING = { type: TypeKey.STRING }
  export const BOOLEAN: BOOLEAN = { type: TypeKey.BOOLEAN }
  export const VARINT: VARINT = { type: TypeKey.VARINT }
  export const FLOAT64: FLOAT64 = { type: TypeKey.FLOAT64 }
  export const BYTES: BYTES = { type: TypeKey.BYTES }

  export type FIXED = { type: TypeKey.FIXED, length: number }
  export type BLOCK = { type: TypeKey.BLOCK, of: Wire.Type, key: BlockKey, dedupe: boolean }
  export type ARRAY = { type: TypeKey.ARRAY, of: Wire.Type }
  export type NULLABLE = { type: TypeKey.NULLABLE, of: Wire.Type }
  export type RECORD = { type: TypeKey.RECORD, fields: Wire.Field[] }

  export type DESC = { type: TypeKey.DESC }
  export const DESC: DESC = { type: TypeKey.DESC }

  export type Field = {
    "name": string,
    type: Wire.Type,
    omittable: boolean
  }

  export function isSTRING(type: Wire.Type): type is Wire.STRING { return type.type == TypeKey.STRING }
  export function isBOOLEAN(type: Wire.Type): type is Wire.BOOLEAN { return type.type == TypeKey.BOOLEAN }
  export function isVARINT(type: Wire.Type): type is Wire.VARINT { return type.type == TypeKey.VARINT }
  export function isFLOAT64(type: Wire.Type): type is Wire.FLOAT64 { return type.type == TypeKey.FLOAT64 }
  export function isBYTES(type: Wire.Type): type is Wire.BYTES { return type.type == TypeKey.BYTES }
  export function isFIXED(type: Wire.Type): type is Wire.FIXED { return type.type == TypeKey.FIXED }
  export function isBLOCK(type: Wire.Type): type is Wire.BLOCK { return type.type == TypeKey.BLOCK }
  export function isARRAY(type: Wire.Type): type is Wire.ARRAY { return type.type == TypeKey.ARRAY }
  export function isNULLABLE(type: Wire.Type): type is Wire.NULLABLE { return type.type == TypeKey.NULLABLE }
  export function isRECORD(type: Wire.Type): type is Wire.RECORD { return type.type == TypeKey.RECORD }

  export function isLabeled(wt: Wire.Type): Boolean { // do values start with a Label
    return isNULLABLE(wt) || isSTRING(wt) || isBOOLEAN(wt) || isBYTES(wt) || isARRAY(wt) || (isBLOCK(wt) && isLabeled(wt.of))
  }

  export function nullable(wt: Wire.Type): Wire.NULLABLE {
    return { type: TypeKey.NULLABLE, of: wt }
  }

  export function block(of: Wire.Type, key: BlockKey, dedupe: boolean): Wire.BLOCK {
    return { type: TypeKey.BLOCK, of, key, dedupe }
  }

  export function print(wt: Wire.Type, indent: number = 0): string {
    const idnt = (plus: number = 0) => " ".repeat(indent + plus)
    const recurse = (wt: Wire.Type): string => print(wt, indent + 1)
    const inner = () => {
      switch (wt.type) {
        case 'STRING':
        case 'VARINT':
        case 'BOOLEAN':
        case 'FLOAT64':
        case 'BYTES':
        case 'DESC':
          return wt.type
        case 'NULLABLE': return recurse(wt.of) + "?"
        case 'FIXED': return `${wt.type}(${wt.length})`
        case 'BLOCK':
          return recurse(wt.of) + (wt.dedupe ? "<" : "{") + wt.key + (wt.dedupe ? ">" : "}")
        case 'ARRAY': return recurse(wt.of) + "[]"
        case 'RECORD':
          const fs = wt.fields.map(({ name, type, omittable }) => idnt(1) + `${name}${omittable ? "?" : ""}: ${recurse(type).trimStart()}`)
          return "{\n" + fs.join("\n") + "\n" + idnt() + "}"
        default: throw "Programmer error: print can't handle " + JSON.stringify(wt)
      }
    }
    return idnt() + inner()
  }

  export function deduplicateByDefault(t: Wire.Type): boolean {
    switch (t.type) {
      case 'STRING': return true
      case 'BOOLEAN': return false
      case 'VARINT': return false
      case 'FLOAT64': return false
      case 'BYTES': return true
      case 'FIXED': return false
      default: throw 'Programmer error: deduplicateByDefault does not make sense for ' + JSON.stringify(t)
    }
  }

  export namespace SelfDescribing {
    export namespace TypeMarker {
      export const Null = Label.NullMarker // -1
      export const False = Label.FalseMarker // 0
      export const True = Label.TrueMarker // 1
      export const Object = 2n
      export const List = 3n
      export const String = 4n
      export const Bytes = 5n
      export const Int = 6n
      export const Float = 7n
    }
    // Each of these marks a self-describing value, which generally follows it
    export const Null = Label.Null
    export const False = Label.False
    export const True = Label.True
    export const Object = Label.encode(TypeMarker.Object)
    export const String = Label.encode(TypeMarker.String)
    export const Bytes = Label.encode(TypeMarker.Bytes)
    export const Int = Label.encode(TypeMarker.Int)
    export const Float = Label.encode(TypeMarker.Float)
    export const List = Label.encode(TypeMarker.List)

    export namespace Blocks {
      export const STRING = Wire.block(Wire.STRING, 'String', deduplicateByDefault(Wire.STRING))
      export const BYTES = Wire.block(Wire.BYTES, 'Bytes', deduplicateByDefault(Wire.BYTES))
      export const VARINT = Wire.block(Wire.VARINT, 'Int', deduplicateByDefault(Wire.VARINT))
      export const FLOAT64 = Wire.block(Wire.FLOAT64, 'Float', deduplicateByDefault(Wire.FLOAT64))
    }
  }
}
