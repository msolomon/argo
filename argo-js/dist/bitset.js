/*
 * Bitset functions for packing booleans compactly into a bigint.
 * Supports both fixed-length and variable-length bitsets.
 *
 * This file and its contents are public domain, copy/paste at your leisure.
 */
/**
 * Bitset functions for packing booleans compactly into a bigint.
 */
export var BitSet;
(function (BitSet) {
    function getBit(bs, index) {
        if (index < 0)
            throw 'Bitset index must be positive';
        return (bs & (1n << BigInt(index))) > 0n;
    }
    BitSet.getBit = getBit;
    function setBit(bs, index) {
        if (index < 0)
            throw 'Bitset index must be positive';
        return (bs | 1n << BigInt(index));
    }
    BitSet.setBit = setBit;
    function unsetBit(bs, index) {
        if (index < 0)
            throw 'Bitset index must be positive';
        return (bs & ~(1n << BigInt(index)));
    }
    BitSet.unsetBit = unsetBit;
    /**
     * Variable-length self-delimiting bitsets
     */
    let Var;
    (function (Var) {
        function read(bytes, pos = 0) {
            const startPos = pos;
            let bitset = 0n;
            let more = bytes.length > 0;
            let bitPos = 0;
            while (more) {
                const byte = bytes[pos];
                if (byte < 0 || byte > 255)
                    throw 'Bitset arrays must only contain positive byte values';
                bitset = bitset | BigInt(((byte & 0xff) >> 1) << bitPos);
                bitPos += 7;
                pos++;
                more = (byte & 1) == 1;
            }
            return { length: pos - startPos, bitset };
        }
        Var.read = read;
        function write(bitset, padToLength = 1) {
            if (bitset < 0)
                throw 'Bitsets must only contain positive values';
            let bytes = [];
            let more = bitset > 0;
            while (more) {
                let byte = Number(bitset & 0x7fn) << 1;
                bitset = bitset >> 7n;
                more = bitset > 0;
                if (more)
                    byte = byte | 1;
                bytes.push(byte);
            }
            if (padToLength > bytes.length) {
                bytes = bytes.concat(Array(padToLength - bytes.length).fill(0));
            }
            return bytes;
        }
        Var.write = write;
    })(Var = BitSet.Var || (BitSet.Var = {}));
    /**
     * Fixed-length undelimited bitsets
     */
    let Fixed;
    (function (Fixed) {
        function write(bitset, padToLength = 1) {
            if (bitset < 0)
                throw 'Bitsets must only contain positive values';
            let bytes = [];
            let more = bitset > 0;
            while (more) {
                let byte = Number(bitset & 0xffn);
                bitset = bitset >> 8n;
                more = bitset > 0;
                bytes.push(byte);
            }
            if (padToLength > bytes.length) {
                bytes = bytes.concat(Array(padToLength - bytes.length).fill(0));
            }
            return bytes;
        }
        Fixed.write = write;
        function read(bytes, pos = 0, length) {
            const startPos = pos;
            let bitset = 0n;
            let more = pos - startPos < length;
            let bitPos = 0;
            while (more) {
                const byte = bytes[pos];
                if (byte < 0 || byte > 255)
                    throw 'Bitset arrays must only contain positive byte values';
                bitset = bitset | BigInt(((byte & 0xff)) << bitPos);
                bitPos += 8;
                pos++;
                more = pos - startPos < length;
            }
            return bitset;
        }
        Fixed.read = read;
        function bytesNeededForNumBits(numBits) {
            return Math.ceil(numBits / 8);
        }
        Fixed.bytesNeededForNumBits = bytesNeededForNumBits;
    })(Fixed = BitSet.Fixed || (BitSet.Fixed = {}));
})(BitSet || (BitSet = {}));
