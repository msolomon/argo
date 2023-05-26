/** Argo Wire encoding */
export declare namespace Wire {
    /** All possible types of a value */
    type Type = Wire.STRING | Wire.BOOLEAN | Wire.VARINT | Wire.FLOAT64 | Wire.BYTES | Wire.FIXED | Wire.BLOCK | Wire.ARRAY | Wire.NULLABLE | Wire.RECORD | Wire.DESC;
    type BlockKey = string;
    /** The names of a value */
    enum TypeKey {
        STRING = "STRING",
        BOOLEAN = "BOOLEAN",
        VARINT = "VARINT",
        FLOAT64 = "FLOAT64",
        BYTES = "BYTES",
        FIXED = "FIXED",
        BLOCK = "BLOCK",
        NULLABLE = "NULLABLE",
        ARRAY = "ARRAY",
        RECORD = "RECORD",
        DESC = "DESC"
    }
    type STRING = {
        type: TypeKey.STRING;
    };
    type BOOLEAN = {
        type: TypeKey.BOOLEAN;
    };
    type VARINT = {
        type: TypeKey.VARINT;
    };
    type FLOAT64 = {
        type: TypeKey.FLOAT64;
    };
    type BYTES = {
        type: TypeKey.BYTES;
    };
    const STRING: Wire.STRING;
    const BOOLEAN: BOOLEAN;
    const VARINT: VARINT;
    const FLOAT64: FLOAT64;
    const BYTES: BYTES;
    type FIXED = {
        type: TypeKey.FIXED;
        length: number;
    };
    type BLOCK = {
        type: TypeKey.BLOCK;
        of: Wire.Type;
        key: BlockKey;
        dedupe: boolean;
    };
    type ARRAY = {
        type: TypeKey.ARRAY;
        of: Wire.Type;
    };
    type NULLABLE = {
        type: TypeKey.NULLABLE;
        of: Wire.Type;
    };
    type RECORD = {
        type: TypeKey.RECORD;
        fields: Wire.Field[];
    };
    type DESC = {
        type: TypeKey.DESC;
    };
    const DESC: DESC;
    type Field = {
        "name": string;
        type: Wire.Type;
        omittable: boolean;
    };
    function isSTRING(type: Wire.Type): type is Wire.STRING;
    function isBOOLEAN(type: Wire.Type): type is Wire.BOOLEAN;
    function isVARINT(type: Wire.Type): type is Wire.VARINT;
    function isFLOAT64(type: Wire.Type): type is Wire.FLOAT64;
    function isBYTES(type: Wire.Type): type is Wire.BYTES;
    function isFIXED(type: Wire.Type): type is Wire.FIXED;
    function isBLOCK(type: Wire.Type): type is Wire.BLOCK;
    function isARRAY(type: Wire.Type): type is Wire.ARRAY;
    function isNULLABLE(type: Wire.Type): type is Wire.NULLABLE;
    function isRECORD(type: Wire.Type): type is Wire.RECORD;
    function isLabeled(wt: Wire.Type): Boolean;
    function nullable(wt: Wire.Type): Wire.NULLABLE;
    function block(of: Wire.Type, key: BlockKey, dedupe: boolean): Wire.BLOCK;
    function print(wt: Wire.Type, indent?: number): string;
    function deduplicateByDefault(t: Wire.Type): boolean;
    namespace SelfDescribing {
        namespace TypeMarker {
            const Null: bigint;
            const False: bigint;
            const True: bigint;
            const Object = 2n;
            const List = 3n;
            const String = 4n;
            const Bytes = 5n;
            const Int = 6n;
            const Float = 7n;
        }
        const Null: Uint8Array;
        const False: Uint8Array;
        const True: Uint8Array;
        const Object: Uint8Array;
        const String: Uint8Array;
        const Bytes: Uint8Array;
        const Int: Uint8Array;
        const Float: Uint8Array;
        const List: Uint8Array;
        namespace Blocks {
            const STRING: BLOCK;
            const BYTES: BLOCK;
            const VARINT: BLOCK;
            const FLOAT64: BLOCK;
        }
    }
}
