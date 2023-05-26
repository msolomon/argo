/** Shares the implementation of a positioned buffer */
class BufBase {
    /** The current position in the buffer (offset in bytes) */
    position = 0;
    /**
     * Resets the position to the given offset (0 by default). Bounds are not checked.
     *
     * @param position The offset to set the position to
     */
    resetPosition = (position = 0) => {
        this.position = position;
    };
    /**
     * Increments the position by the given amount. Bounds are not checked.
     *
     * @param position The amount to adjust the position by
     */
    incrementPosition = (amount = 1) => {
        this.resetPosition(this.position + amount);
    };
}
/** A dynamically-resized buffer of bytes.
 *
 * This would be unnecessary if Uint8Array and ArrayBuffer could resize.
 *
 * In addition to storing bytes and providing resizing behavior,
 * it tracks the current position in the buffer and the highest written byte.
 * This makes it convenient for our use cases.
 */
export class Buf extends BufBase {
    initialSize;
    growthFactor;
    constructor(initialSize = 256, growthFactor = 2) {
        super();
        this.initialSize = initialSize;
        this.growthFactor = growthFactor;
        if (initialSize < 0)
            throw new Error('initialSize must be non-negative');
        if (Math.trunc(initialSize) !== initialSize)
            throw new Error('initialSize must be an integer');
        if (growthFactor <= 1)
            throw new Error('growthFactor must be greater than 1');
        this._buffer = new ArrayBuffer(initialSize);
        this._bytes = new Uint8Array(this._buffer);
    }
    /** The current contents of the buffer */
    _buffer;
    /** A typed view of the buffer as bytes */
    _bytes;
    /** The highest written byte */
    _end = 0;
    /**
     * Returns the ArrayBuffer currently backing the Buf.
     *
     * Do not retain references to this, as it may be replaced!
     */
    get buffer() {
        return this._buffer;
    }
    /**
     * Returns a Uint8Array view of the ArrayBuffer currently backing the Buf.
     *
     * Do not retain references to this, as it may be replaced!
     */
    get uint8array() {
        return this._bytes;
    }
    /** The amount of the buffer that has been written to in bytes */
    get length() {
        return this._end;
    }
    /** The capacity of the current underlying buffer in bytes */
    get capacity() {
        return this._buffer.byteLength;
    }
    /**
     * Write bytes to the buffer at the current position.
     *
     * @param bytes The bytes to write to the buffer
     */
    write = (bytes) => {
        if (bytes.length === 0)
            return;
        const newPosition = this.position + bytes.length;
        this.resizeIfNecessary(newPosition);
        this._bytes.set(bytes, this.position);
        this.updateEndIfNecessary(newPosition);
        this.position = newPosition;
    };
    /**
     * Write bytes to the buffer at the current position.
     *
     * @param bytes The Buf to write to the buffer
     */
    writeBuf = (buf) => {
        this.write(buf.uint8array.subarray(0, buf.length));
    };
    /**
     * Write a single byte to the buffer at the current position.
     * Behavior for values which aren't integers in the range 0-255 follows Uint8Array.
     *
     * @param byte The byte to write to the buffer
     */
    writeByte = (byte) => {
        this.set(this.position, byte);
        this.position++;
    };
    /**
     * Read bytes from the buffer at the current position.
     *
     * @param numBytes The number of bytes to read from the buffer. If the buffer does not contain this many bytes, the returned array will be shorter.
     * @returns A Uint8Array containing the bytes read from the buffer
     */
    read = (numBytes) => {
        const data = this._bytes.subarray(this.position, this.position + numBytes);
        this.position += data.byteLength; // may be shorter than numBytes
        return data;
    };
    /**
     * Writes a single byte to the buffer at the given position.
     *
     * @param position The offset to write the byte to
     * @param byte The byte to write to the buffer
     */
    set = (position, byte) => {
        this.resizeIfNecessary(position + 1);
        this._bytes[position] = byte;
        this.updateEndIfNecessary(position + 1);
    };
    /**
     * Reads a single byte from the buffer at the given position without adjusting the position.
     *
     * @param position The offset to read the byte from
     * @returns The byte at the given position
     */
    get = (position) => {
        position = position ?? this.position;
        const data = this._bytes[position];
        return data;
    };
    // resizes the buffer if necessary to accommodate the given size
    resizeIfNecessary(sizeRequired) {
        if (sizeRequired > this._buffer.byteLength) {
            let newSize = Math.max(this._buffer.byteLength, 1); // use 1 when buffer is size 0
            while (newSize < sizeRequired)
                newSize *= this.growthFactor;
            this.resizeTo(Math.ceil(newSize));
        }
    }
    updateEndIfNecessary(position) {
        if (this._end < position)
            this._end = position;
    }
    // Resize the buffer to the given number of bytes, truncating if necessary
    resizeTo(newSize) {
        if (newSize === this._buffer.byteLength)
            return;
        const newBuffer = new ArrayBuffer(newSize);
        const newBytes = new Uint8Array(newBuffer);
        newBytes.set(this._bytes.subarray(0, newSize));
        this._buffer = newBuffer;
        this._bytes = newBytes;
    }
    /** Resizes the underlying buffers to be as small as possible */
    compact = () => {
        this.resizeTo(this._end);
    };
}
/** A Buf which supports reads and is backed by a Uint8Array */
export class BufReadonly extends BufBase {
    _bytes;
    constructor(_bytes) {
        super();
        this._bytes = _bytes;
    }
    read = (numBytes) => {
        const data = this._bytes.subarray(this.position, this.position + numBytes);
        this.position += data.byteLength; // may be shorter than numBytes
        return data;
    };
    get = (position = this.position) => {
        const data = this._bytes[position];
        return data;
    };
    get uint8array() { return this._bytes; }
    get length() { return this._bytes.byteLength; }
}
