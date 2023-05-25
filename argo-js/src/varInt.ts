/*
 *  Variable-length integer encodings
 * 
 * This file and its contents are public domain, copy/paste at your leisure.
 */


/**
 * Variable-length integer encoding for unsigned integers.
 * 
 * This uses ULEB128: https://en.wikipedia.org/wiki/LEB128#Unsigned_LEB128
 */
export namespace Unsigned {
  export function bytesNeeded(n: bigint): number {
    if (n <= 0x7fn) return 1
    if (n <= 0x3fffn) return 2
    if (n <= 0x1fffffn) return 3
    if (n <= 0xfffffffn) return 4
    if (n <= 0x7ffffffffn) return 5
    if (n <= 0x3ffffffffffn) return 6
    if (n <= 0x1ffffffffffffn) return 7
    if (n <= 0xffffffffffffffn) return 8
    if (n <= 0x7fffffffffffffffn) return 9

    let needed = 0
    while (n > 0) {
      needed++
      n >>= 7n
    }
    return needed
  }

  export function encode(n: bigint | number): Uint8Array {
    n = BigInt(n)
    const length = bytesNeeded(n)
    const buf = new Uint8Array(length)
    encodeInto(n, buf, 0)
    return buf
  }

  export function encodeInto(n: bigint | number, buf: { [index: number]: number }, offset: number = 0): number {
    n = BigInt(n)
    let pos = offset
    do {
      let octet = n & 0x7fn
      n = n >> 7n
      buf[pos] = Number(octet | (n ? 0x80n : 0x0n))
      pos++
    } while (n)
    return pos - offset
  }

  export function decode(buf: Uint8Array, offset: number = 0): { result: bigint, length: number } {
    let result = 0n
    let shift = 0n
    let pos = offset
    while (true) {
      let octet = buf[pos]
      result |= BigInt((octet & 0x7f)) << shift
      ++pos
      if (!(octet & 0x80)) return { result, length: pos - offset }
      shift += 7n
    }
  }
}

/**
 * Variable-length integer encoding using zig-zag. Good for integers near 0.
 * 
 * https://en.wikipedia.org/wiki/Variable-length_quantity#Zigzag_encoding
 * 
 * This is compatible with Google's protobuf zig-zag encoding.
 */
export namespace ZigZag {
  export function encode(n: bigint | number): Uint8Array {
    return Unsigned.encode(toZigZag(BigInt(n)))
  }

  export function encodeInto(n: bigint | number, buf: { [index: number]: number }, offset: number = 0): number {
    return Unsigned.encodeInto(toZigZag(BigInt(n)), buf, offset)
  }

  export function decode(buf: Uint8Array, offset: number = 0): { result: bigint, length: number } {
    const { result, length } = Unsigned.decode(buf, offset)
    return { result: fromZigZag(result), length }
  }

  export function toZigZag(n: bigint): bigint {
    return n >= 0 ? n << 1n : (n << 1n) ^ (~0n)
  }

  export function fromZigZag(n: bigint): bigint {
    return (n & 0x1n) ? n >> 1n ^ (~0n) : n >> 1n
  }
}
