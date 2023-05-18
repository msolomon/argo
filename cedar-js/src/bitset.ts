
export type BitSet = bigint

/**
 * Bitset functions for packing booleans compactly into a bigint.
 */
export namespace BitSet {

  export function getBit(bs: bigint, index: number): boolean {
    if (index < 0) throw 'Bitset index must be positive'
    return (bs & (1n << BigInt(index))) > 0n
  }

  export function setBit(bs: bigint, index: number): bigint {
    if (index < 0) throw 'Bitset index must be positive'
    return (bs | 1n << BigInt(index))
  }

  export function unsetBit(bs: bigint, index: number): bigint {
    if (index < 0) throw 'Bitset index must be positive'
    return (bs & ~(1n << BigInt(index)))
  }

  /**
   * Variable-length self-delimiting bitsets
   */
  export namespace Var {
    export function read(bytes: ArrayLike<number>, pos: number = 0): { length: number, bitset: bigint } {
      const startPos = pos
      let bitset = 0n
      let more = bytes.length > 0
      let bitPos = 0
      while (more) {
        const byte = bytes[pos]
        if (byte < 0 || byte > 255) throw 'Bitset arrays must only contain positive byte values'
        bitset = bitset | BigInt(((byte & 0xff) >> 1) << bitPos)
        bitPos += 7
        pos++
        more = (byte & 1) == 1
      }
      return { length: pos - startPos, bitset }
    }

    export function write(bitset: bigint, padToLength: number = 1): ArrayLike<number> {
      if (bitset < 0) throw 'Bitsets must only contain positive values'
      let bytes: number[] = []
      let more = bitset > 0
      while (more) {
        let byte = Number(bitset & 0x7fn) << 1
        bitset = bitset >> 7n
        more = bitset > 0
        if (more) byte = byte | 1
        bytes.push(byte)
      }
      if (padToLength > bytes.length) {
        bytes = bytes.concat(Array(padToLength - bytes.length).fill(0))
      }
      return bytes
    }
  }

  /**
   * Fixed-length undelimited bitsets
   */
  export namespace Fixed {
    export function write(bitset: bigint, padToLength: number = 1): ArrayLike<number> {
      if (bitset < 0) throw 'Bitsets must only contain positive values'
      let bytes: number[] = []
      let more = bitset > 0
      while (more) {
        let byte = Number(bitset & 0xffn)
        bitset = bitset >> 8n
        more = bitset > 0
        bytes.push(byte)
      }
      if (padToLength > bytes.length) {
        bytes = bytes.concat(Array(padToLength - bytes.length).fill(0))
      }
      return bytes
    }

    export function read(bytes: ArrayLike<number>, pos: number = 0, length: number): bigint {
      const startPos = pos
      let bitset = 0n
      let more = pos - startPos < length
      let bitPos = 0
      while (more) {
        const byte = bytes[pos]
        if (byte < 0 || byte > 255) throw 'Bitset arrays must only contain positive byte values'
        bitset = bitset | BigInt(((byte & 0xff)) << bitPos)
        bitPos += 8
        pos++
        more = pos - startPos < length
      }
      return bitset
    }

    export function bytesNeededForNumBits(numBits: number): number {
      return Math.ceil(numBits / 8)
    }
  }
}