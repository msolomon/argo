import { Unsigned, ZigZag } from "../src/varInt"

test('unsigned: round trip through bytes', () => {
  const writeRead = (n: bigint) => Unsigned.decode(Unsigned.encode(n)).result
  expect(writeRead(0n)).toEqual(0n)
  expect(writeRead(1n)).toEqual(1n)
  expect(writeRead(127n)).toEqual(127n)
  expect(writeRead(128n)).toEqual(128n)
  expect(writeRead(255n)).toEqual(255n)
  expect(writeRead(256n)).toEqual(256n)
  expect(writeRead(0xffffffn)).toEqual(0xffffffn)
  expect(writeRead(10000000000000000000000n)).toEqual(10000000000000000000000n)
})

test('zigzag: round trip through bytes', () => {
  const writeRead = (n: bigint) => ZigZag.decode(ZigZag.encode(n)).result
  expect(writeRead(0n)).toEqual(0n)
  expect(writeRead(1n)).toEqual(1n)
  expect(writeRead(127n)).toEqual(127n)
  expect(writeRead(128n)).toEqual(128n)
  expect(writeRead(255n)).toEqual(255n)
  expect(writeRead(256n)).toEqual(256n)
  expect(writeRead(0xffffffn)).toEqual(0xffffffn)
  expect(writeRead(10000000000000000000000n)).toEqual(10000000000000000000000n)

  expect(writeRead(-0n)).toEqual(-0n)
  expect(writeRead(-1n)).toEqual(-1n)
  expect(writeRead(-127n)).toEqual(-127n)
  expect(writeRead(-128n)).toEqual(-128n)
  expect(writeRead(-255n)).toEqual(-255n)
  expect(writeRead(-256n)).toEqual(-256n)
  expect(writeRead(-0xffffffn)).toEqual(-0xffffffn)
  expect(writeRead(-1877182192n)).toEqual(-1877182192n)
  expect(writeRead(-10000000000000000000000n)).toEqual(-10000000000000000000000n)
})
