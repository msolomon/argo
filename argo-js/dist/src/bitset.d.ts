export type BitSet = bigint;
/**
 * Bitset functions for packing booleans compactly into a bigint.
 */
export declare namespace BitSet {
    function getBit(bs: bigint, index: number): boolean;
    function setBit(bs: bigint, index: number): bigint;
    function unsetBit(bs: bigint, index: number): bigint;
    /**
     * Variable-length self-delimiting bitsets
     */
    namespace Var {
        function read(bytes: ArrayLike<number>, pos?: number): {
            length: number;
            bitset: bigint;
        };
        function write(bitset: bigint, padToLength?: number): ArrayLike<number>;
    }
    /**
     * Fixed-length undelimited bitsets
     */
    namespace Fixed {
        function write(bitset: bigint, padToLength?: number): ArrayLike<number>;
        function read(bytes: ArrayLike<number>, pos: number | undefined, length: number): bigint;
        function bytesNeededForNumBits(numBits: number): number;
    }
}
