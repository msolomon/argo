import { BitSet } from "../src/bitset"

test('round trip through bytes', () => {
  const writeRead = (n: bigint) => BitSet.Var.read(BitSet.Var.write(n)).bitset
  expect(writeRead(0n)).toEqual(0n)
  expect(writeRead(1n)).toEqual(1n)
  expect(writeRead(127n)).toEqual(127n)
  expect(writeRead(128n)).toEqual(128n)
  expect(writeRead(255n)).toEqual(255n)
  expect(writeRead(256n)).toEqual(256n)
  expect(writeRead(0xffffffn)).toEqual(0xffffffn)
})

test('round trip through bit setting', () => {
  const bits = 65
  const tst = (bs: bigint, bitnum: number) => {
    const wasSet = BitSet.getBit(bs, bitnum)
    let newBs = BitSet.setBit(bs, bitnum)
    expect(BitSet.getBit(newBs, bitnum)).toBe(true)
    newBs = BitSet.unsetBit(newBs, bitnum)
    expect(BitSet.getBit(newBs, bitnum)).toBe(false)
    if (wasSet) newBs = BitSet.setBit(newBs, bitnum)
    expect(newBs).toEqual(bs)
  }
  for (let i = 0; i < bits; i++) {
    for (let j = 0; j < bits; j++) {
      tst(BigInt(i), j)
    }
  }
})

test('round trip through bytes (fixed bitset)', () => {
  const writeRead = (n: bigint) => {
    const bs = BitSet.Fixed.write(n)
    return BitSet.Fixed.read(bs, 0, bs.length)
  }
  expect(writeRead(0n)).toEqual(0n)
  expect(writeRead(1n)).toEqual(1n)
  expect(writeRead(127n)).toEqual(127n)
  expect(writeRead(128n)).toEqual(128n)
  expect(writeRead(255n)).toEqual(255n)
  expect(writeRead(256n)).toEqual(256n)
  expect(writeRead(0xffffffn)).toEqual(0xffffffn)
})


test('round trip through bit setting (fixed bitset)', () => {
  const bits = 65
  const tst = (bs: bigint, bitnum: number) => {
    const wasSet = BitSet.getBit(bs, bitnum)
    let newBs = BitSet.setBit(bs, bitnum)
    expect(BitSet.getBit(newBs, bitnum)).toBe(true)
    newBs = BitSet.unsetBit(newBs, bitnum)
    expect(BitSet.getBit(newBs, bitnum)).toBe(false)
    if (wasSet) newBs = BitSet.setBit(newBs, bitnum)
    expect(newBs).toEqual(bs)
  }
  for (let i = 0; i < bits; i++) {
    for (let j = 0; j < bits; j++) {
      tst(BigInt(i), j)
    }
  }
})