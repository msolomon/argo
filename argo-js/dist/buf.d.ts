/** A dynamically-sized byte buffer which tracks the current position */
interface BufPosition {
    position: number;
    resetPosition(position: number): void;
    incrementPosition(numBytes?: number): void;
}
/** A dynamically-sized byte buffer which supports reading */
export interface BufRead extends BufPosition {
    read(numBytes: number): Uint8Array;
    get(position?: number): number | undefined;
    get uint8array(): Uint8Array;
    get length(): number;
}
/** A dynamically-sized byte buffer which supports writing */
export interface BufWrite extends BufPosition {
    write(bytes: ArrayLike<number>): void;
    writeBuf(buf: Buf): void;
    writeByte(byte: number): void;
    get capacity(): number;
}
/** Shares the implementation of a positioned buffer */
declare abstract class BufBase implements BufPosition {
    /** The current position in the buffer (offset in bytes) */
    position: number;
    /**
     * Resets the position to the given offset (0 by default). Bounds are not checked.
     *
     * @param position The offset to set the position to
     */
    resetPosition: (position?: number) => void;
    /**
     * Increments the position by the given amount. Bounds are not checked.
     *
     * @param position The amount to adjust the position by
     */
    incrementPosition: (amount?: number) => void;
}
/** A dynamically-resized buffer of bytes.
 *
 * This would be unnecessary if Uint8Array and ArrayBuffer could resize.
 *
 * In addition to storing bytes and providing resizing behavior,
 * it tracks the current position in the buffer and the highest written byte.
 * This makes it convenient for our use cases.
 */
export declare class Buf extends BufBase implements BufPosition, BufRead, BufWrite {
    private readonly initialSize;
    private readonly growthFactor;
    constructor(initialSize?: number, growthFactor?: number);
    /** The current contents of the buffer */
    private _buffer;
    /** A typed view of the buffer as bytes */
    private _bytes;
    /** The highest written byte */
    private _end;
    /**
     * Returns the ArrayBuffer currently backing the Buf.
     *
     * Do not retain references to this, as it may be replaced!
     */
    get buffer(): ArrayBuffer;
    /**
     * Returns a Uint8Array view of the ArrayBuffer currently backing the Buf.
     *
     * Do not retain references to this, as it may be replaced!
     */
    get uint8array(): Uint8Array;
    /** The amount of the buffer that has been written to in bytes */
    get length(): number;
    /** The capacity of the current underlying buffer in bytes */
    get capacity(): number;
    /**
     * Write bytes to the buffer at the current position.
     *
     * @param bytes The bytes to write to the buffer
     */
    write: (bytes: ArrayLike<number>) => void;
    /**
     * Write bytes to the buffer at the current position.
     *
     * @param bytes The Buf to write to the buffer
     */
    writeBuf: (buf: Buf) => void;
    /**
     * Write a single byte to the buffer at the current position.
     * Behavior for values which aren't integers in the range 0-255 follows Uint8Array.
     *
     * @param byte The byte to write to the buffer
     */
    writeByte: (byte: number) => void;
    /**
     * Read bytes from the buffer at the current position.
     *
     * @param numBytes The number of bytes to read from the buffer. If the buffer does not contain this many bytes, the returned array will be shorter.
     * @returns A Uint8Array containing the bytes read from the buffer
     */
    read: (numBytes: number) => Uint8Array;
    /**
     * Writes a single byte to the buffer at the given position.
     *
     * @param position The offset to write the byte to
     * @param byte The byte to write to the buffer
     */
    set: (position: number, byte: number) => void;
    /**
     * Reads a single byte from the buffer at the given position without adjusting the position.
     *
     * @param position The offset to read the byte from
     * @returns The byte at the given position
     */
    get: (position?: number) => number | undefined;
    private resizeIfNecessary;
    private updateEndIfNecessary;
    resizeTo(newSize: number): void;
    /** Resizes the underlying buffers to be as small as possible */
    compact: () => void;
}
/** A Buf which supports reads and is backed by a Uint8Array */
export declare class BufReadonly extends BufBase implements BufPosition, BufRead {
    private readonly _bytes;
    constructor(_bytes: Uint8Array);
    read: (numBytes: number) => Uint8Array;
    get: (position?: number) => number | undefined;
    get uint8array(): Uint8Array;
    get length(): number;
}
export {};
