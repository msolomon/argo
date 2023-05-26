import { Label } from './label';
/** Argo Wire encoding */
export var Wire;
(function (Wire) {
    /** The names of a value */
    let TypeKey;
    (function (TypeKey) {
        // Primitive types
        TypeKey["STRING"] = "STRING";
        TypeKey["BOOLEAN"] = "BOOLEAN";
        TypeKey["VARINT"] = "VARINT";
        TypeKey["FLOAT64"] = "FLOAT64";
        TypeKey["BYTES"] = "BYTES";
        // Compound types
        TypeKey["FIXED"] = "FIXED";
        TypeKey["BLOCK"] = "BLOCK";
        TypeKey["NULLABLE"] = "NULLABLE";
        TypeKey["ARRAY"] = "ARRAY";
        TypeKey["RECORD"] = "RECORD";
        TypeKey["DESC"] = "DESC";
    })(TypeKey = Wire.TypeKey || (Wire.TypeKey = {}));
    Wire.STRING = { type: TypeKey.STRING };
    Wire.BOOLEAN = { type: TypeKey.BOOLEAN };
    Wire.VARINT = { type: TypeKey.VARINT };
    Wire.FLOAT64 = { type: TypeKey.FLOAT64 };
    Wire.BYTES = { type: TypeKey.BYTES };
    Wire.DESC = { type: TypeKey.DESC };
    function isSTRING(type) { return type.type == TypeKey.STRING; }
    Wire.isSTRING = isSTRING;
    function isBOOLEAN(type) { return type.type == TypeKey.BOOLEAN; }
    Wire.isBOOLEAN = isBOOLEAN;
    function isVARINT(type) { return type.type == TypeKey.VARINT; }
    Wire.isVARINT = isVARINT;
    function isFLOAT64(type) { return type.type == TypeKey.FLOAT64; }
    Wire.isFLOAT64 = isFLOAT64;
    function isBYTES(type) { return type.type == TypeKey.BYTES; }
    Wire.isBYTES = isBYTES;
    function isFIXED(type) { return type.type == TypeKey.FIXED; }
    Wire.isFIXED = isFIXED;
    function isBLOCK(type) { return type.type == TypeKey.BLOCK; }
    Wire.isBLOCK = isBLOCK;
    function isARRAY(type) { return type.type == TypeKey.ARRAY; }
    Wire.isARRAY = isARRAY;
    function isNULLABLE(type) { return type.type == TypeKey.NULLABLE; }
    Wire.isNULLABLE = isNULLABLE;
    function isRECORD(type) { return type.type == TypeKey.RECORD; }
    Wire.isRECORD = isRECORD;
    function isLabeled(wt) {
        return isNULLABLE(wt) || isSTRING(wt) || isBOOLEAN(wt) || isBYTES(wt) || isARRAY(wt) || (isBLOCK(wt) && isLabeled(wt.of));
    }
    Wire.isLabeled = isLabeled;
    function nullable(wt) {
        return { type: TypeKey.NULLABLE, of: wt };
    }
    Wire.nullable = nullable;
    function block(of, key, dedupe) {
        return { type: TypeKey.BLOCK, of, key, dedupe };
    }
    Wire.block = block;
    function print(wt, indent = 0) {
        const idnt = (plus = 0) => " ".repeat(indent + plus);
        const recurse = (wt) => print(wt, indent + 1);
        const inner = () => {
            switch (wt.type) {
                case 'STRING':
                case 'VARINT':
                case 'BOOLEAN':
                case 'FLOAT64':
                case 'BYTES':
                case 'DESC':
                    return wt.type;
                case 'NULLABLE': return recurse(wt.of) + "?";
                case 'FIXED': return `${wt.type}(${wt.length})`;
                case 'BLOCK':
                    return recurse(wt.of) + (wt.dedupe ? "<" : "{") + wt.key + (wt.dedupe ? ">" : "}");
                case 'ARRAY': return recurse(wt.of) + "[]";
                case 'RECORD':
                    const fs = wt.fields.map(({ name, type, omittable }) => idnt(1) + `${name}${omittable ? "?" : ""}: ${recurse(type).trimStart()}`);
                    return "{\n" + fs.join("\n") + "\n" + idnt() + "}";
                default: throw "Programmer error: print can't handle " + JSON.stringify(wt);
            }
        };
        return idnt() + inner();
    }
    Wire.print = print;
    function deduplicateByDefault(t) {
        switch (t.type) {
            case 'STRING': return true;
            case 'BOOLEAN': return false;
            case 'VARINT': return false;
            case 'FLOAT64': return false;
            case 'BYTES': return true;
            case 'FIXED': return false;
            default: throw 'Programmer error: deduplicateByDefault does not make sense for ' + JSON.stringify(t);
        }
    }
    Wire.deduplicateByDefault = deduplicateByDefault;
    let SelfDescribing;
    (function (SelfDescribing) {
        let TypeMarker;
        (function (TypeMarker) {
            TypeMarker.Null = Label.NullMarker; // -1
            TypeMarker.False = Label.FalseMarker; // 0
            TypeMarker.True = Label.TrueMarker; // 1
            TypeMarker.Object = 2n;
            TypeMarker.List = 3n;
            TypeMarker.String = 4n;
            TypeMarker.Bytes = 5n;
            TypeMarker.Int = 6n;
            TypeMarker.Float = 7n;
        })(TypeMarker = SelfDescribing.TypeMarker || (SelfDescribing.TypeMarker = {}));
        // Each of these marks a self-describing value, which generally follows it
        SelfDescribing.Null = Label.Null;
        SelfDescribing.False = Label.False;
        SelfDescribing.True = Label.True;
        SelfDescribing.Object = Label.encode(TypeMarker.Object);
        SelfDescribing.String = Label.encode(TypeMarker.String);
        SelfDescribing.Bytes = Label.encode(TypeMarker.Bytes);
        SelfDescribing.Int = Label.encode(TypeMarker.Int);
        SelfDescribing.Float = Label.encode(TypeMarker.Float);
        SelfDescribing.List = Label.encode(TypeMarker.List);
        let Blocks;
        (function (Blocks) {
            Blocks.STRING = Wire.block(Wire.STRING, 'String', deduplicateByDefault(Wire.STRING));
            Blocks.BYTES = Wire.block(Wire.BYTES, 'Bytes', deduplicateByDefault(Wire.BYTES));
            Blocks.VARINT = Wire.block(Wire.VARINT, 'Int', deduplicateByDefault(Wire.VARINT));
            Blocks.FLOAT64 = Wire.block(Wire.FLOAT64, 'Float', deduplicateByDefault(Wire.FLOAT64));
        })(Blocks = SelfDescribing.Blocks || (SelfDescribing.Blocks = {}));
    })(SelfDescribing = Wire.SelfDescribing || (Wire.SelfDescribing = {}));
})(Wire || (Wire = {}));
