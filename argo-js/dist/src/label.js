import * as VarInt from './varInt';
/** Describes which category of Label it is */
export var LabelKind;
(function (LabelKind) {
    LabelKind[LabelKind["Null"] = 0] = "Null";
    LabelKind[LabelKind["Absent"] = 1] = "Absent";
    LabelKind[LabelKind["Error"] = 2] = "Error";
    LabelKind[LabelKind["Backreference"] = 3] = "Backreference";
    LabelKind[LabelKind["Length"] = 4] = "Length";
})(LabelKind || (LabelKind = {}));
/**
 * A Label is a signed varible-length integer which encodes a length, a backreference, or a special value.
 * It "labels" a value, indicating how it is encoded or some information about it.
 *
 * For example, for a nullable String, the label is generally one of:
 *   - The special value Null
 *   - The length of the String (the value of which is encoded separately)
 *   - A backreference ID to a previously-encountered String, of which this is a duplicate
 */
export var Label;
(function (Label) {
    Label.typeOf = 'bigint';
    Label.TrueMarker = 1n;
    Label.FalseMarker = 0n;
    Label.NonNullMarker = 0n;
    Label.NullMarker = -1n;
    Label.AbsentMarker = -2n;
    Label.ErrorMarker = -3n;
    Label.LowestResevedValue = Label.ErrorMarker;
    Label.Null = VarInt.ZigZag.encode(Label.NullMarker);
    Label.Absent = VarInt.ZigZag.encode(Label.AbsentMarker);
    Label.Error = VarInt.ZigZag.encode(Label.ErrorMarker);
    Label.Zero = VarInt.ZigZag.encode(0);
    Label.NonNull = Label.Zero;
    Label.False = Label.Zero;
    Label.True = VarInt.ZigZag.encode(1);
    function kind(label) {
        if (label >= 0)
            return LabelKind.Length;
        switch (label) {
            case Label.NullMarker: return LabelKind.Null;
            case Label.AbsentMarker: return LabelKind.Absent;
            case Label.ErrorMarker: return LabelKind.Error;
            default: return LabelKind.Backreference;
        }
    }
    Label.kind = kind;
    function isNull(label) { return label == Label.NullMarker; }
    Label.isNull = isNull;
    function isAbsent(label) { return label == Label.AbsentMarker; }
    Label.isAbsent = isAbsent;
    function isError(label) { return label == Label.ErrorMarker; }
    Label.isError = isError;
    function isLength(label) { return label >= 0; }
    Label.isLength = isLength;
    function isBackref(label) { return label < Label.LowestResevedValue; }
    Label.isBackref = isBackref;
    function encode(label) {
        switch (kind(BigInt(label))) {
            case LabelKind.Length:
            case LabelKind.Backreference: return VarInt.ZigZag.encode(label);
            case LabelKind.Null: return Label.Null;
            case LabelKind.Absent: return Label.Absent;
            case LabelKind.Error: return Label.Error;
        }
    }
    Label.encode = encode;
    function read(buf) {
        const label = VarInt.ZigZag.decode(buf.uint8array, buf.position);
        buf.position += label.length;
        return label.result;
    }
    Label.read = read;
    const labelToOffsetFactor = Number(Label.LowestResevedValue) - 1;
    /** Converts a Label to an offset in an array of backreferences */
    function labelToOffset(label) {
        if (label >= 0)
            throw 'Cannot convert non-negative label to offset';
        return -Number(label) + labelToOffsetFactor;
    }
    Label.labelToOffset = labelToOffset;
})(Label || (Label = {}));
