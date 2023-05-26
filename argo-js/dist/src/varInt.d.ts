/**
 * Variable-length integer encoding for unsigned integers.
 *
 * This uses ULEB128: https://en.wikipedia.org/wiki/LEB128#Unsigned_LEB128
 */
export declare namespace Unsigned {
    function bytesNeeded(n: bigint): number;
    function encode(n: bigint | number): Uint8Array;
    function encodeInto(n: bigint | number, buf: {
        [index: number]: number;
    }, offset?: number): number;
    function decode(buf: Uint8Array, offset?: number): {
        result: bigint;
        length: number;
    };
}
/**
 * Variable-length integer encoding using zig-zag. Good for integers near 0.
 *
 * https://en.wikipedia.org/wiki/Variable-length_quantity#Zigzag_encoding
 *
 * This is compatible with Google's protobuf zig-zag encoding.
 */
export declare namespace ZigZag {
    function encode(n: bigint | number): Uint8Array;
    function encodeInto(n: bigint | number, buf: {
        [index: number]: number;
    }, offset?: number): number;
    function decode(buf: Uint8Array, offset?: number): {
        result: bigint;
        length: number;
    };
    function toZigZag(n: bigint): bigint;
    function fromZigZag(n: bigint): bigint;
}
