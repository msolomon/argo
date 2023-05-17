import { Buf } from "../src/buf"

// TODO: write most of the tests

test('writeByte', () => {
  const buf = new Buf(0)
  expect(buf.capacity).toEqual(0)
  buf.writeByte(0x01)
  expect(buf.position).toEqual(1)
  expect(buf.length).toEqual(1)
  expect(buf.capacity).toEqual(1)
  expect(buf.get(0)).toEqual(0x01)

  buf.writeByte(0x02)
  expect(buf.position).toEqual(2)
  expect(buf.length).toEqual(2)
  expect(buf.capacity).toEqual(2)
  expect(buf.get(1)).toEqual(0x02)
})

test('write: simple', () => {
  const buf = new Buf()
  buf.write(new Uint8Array([1, 2, 3]))
  expect(buf.position).toEqual(3)
  expect(buf.length).toEqual(3)
  expect(buf.get(0)).toEqual(0x01)
  expect(buf.get(1)).toEqual(0x02)
  expect(buf.get(2)).toEqual(0x03)

  buf.write(([4, 5, 6]))
  expect(buf.position).toEqual(6)
  expect(buf.length).toEqual(6)
  expect(buf.get(3)).toEqual(4)
  expect(buf.get(4)).toEqual(5)
  expect(buf.get(5)).toEqual(6)
})

