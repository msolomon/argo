import { Unsigned, ZigZag } from "../src/varInt"

const testValues = [0n, 1n, 127n, 128n, 255n, 256n, 624485n, 10000000000000000000000n,]

test('unsigned: round trip through bytes', () => {
  const writeRead = (n: bigint) => Unsigned.decode(Unsigned.encode(n)).result
  testValues.forEach(n => expect(writeRead(n)).toEqual(n))
})

test('zigzag: round trip through bytes', () => {
  const writeRead = (n: bigint) => ZigZag.decode(ZigZag.encode(n)).result
  testValues.forEach(n => expect(writeRead(n)).toEqual(n))
  testValues.forEach(n => expect(writeRead(-n)).toEqual(-n))
})
