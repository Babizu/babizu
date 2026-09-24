import { describe, expect, it } from 'vitest'
import { Dawg, FuzzyIndex } from '../../src/fuzzy/index.js'
import { createPazehKaxabuMetric } from '../fixtures/pazeh.js'
import { createRandom, randomString } from './helpers.js'

describe('Dawg', () => {
  const words = ['atun', 'bintul', 'bintun', 'bintulan', 'atulan', 'a', 'alaw']

  it('接受剛好那些詞', () => {
    const dawg = Dawg.build(words)
    for (const w of words) expect(dawg.lookup(w), w).toBeGreaterThanOrEqual(0)
    for (const w of ['bintu', 'bintulaan', 'z', 'atunx', '']) expect(dawg.lookup(w), w).toBe(-1)
    expect(dawg.size).toBe(words.length)
  })

  it('空字串是合法的詞（由 FuzzyIndex 決定要不要收）', () => {
    const dawg = Dawg.build(['', 'a'])
    expect(dawg.lookup('')).toBe(0)
    expect(dawg.lookup('a')).toBe(1)
    expect(dawg.words()).toEqual(['', 'a'])
  })

  it('合併共同後綴：節點數少於同樣詞的 Trie', () => {
    // -ulan 結尾的兩個詞共用後綴
    const dawg = Dawg.build(['atulan', 'bintulan'])
    const trieNodes = 1 + 'atulan'.length + 'bintulan'.length // 沒有共同前綴
    expect(dawg.nodeCount).toBeLessThan(trieNodes)
    expect(dawg.lookup('atulan')).toBeGreaterThanOrEqual(0)
    expect(dawg.lookup('bintulan')).toBeGreaterThanOrEqual(0)
  })

  it('完美雜湊：名次是字典序，且與 wordAt 互為反函式', () => {
    const dawg = Dawg.build(words)
    const sorted = [...new Set(words)].sort()
    sorted.forEach((word, rank) => {
      expect(dawg.lookup(word), word).toBe(rank)
      expect(dawg.wordAt(rank)).toBe(word)
    })
    expect(dawg.wordAt(-1)).toBeNull()
    expect(dawg.wordAt(sorted.length)).toBeNull()
    expect(dawg.words()).toEqual(sorted)
  })

  it('height 是子樹中最長詞剩下的字元數', () => {
    const dawg = Dawg.build(['a', 'abc'])
    expect(dawg.height[dawg.root]).toBe(3)
  })

  it('空詞庫', () => {
    const dawg = Dawg.build([])
    expect(dawg.size).toBe(0)
    expect(dawg.words()).toEqual([])
    expect(dawg.lookup('a')).toBe(-1)
  })

  it('JSON 往返後結構與查詢結果相同', () => {
    const dawg = Dawg.build(words)
    const restored = Dawg.fromJSON(JSON.parse(JSON.stringify(dawg.toJSON())))
    expect(restored.nodeCount).toBe(dawg.nodeCount)
    expect(restored.edgeCount).toBe(dawg.edgeCount)
    expect(restored.words()).toEqual(dawg.words())
    expect(Array.from(restored.height)).toEqual(Array.from(dawg.height))
  })

  it('拒絕格式不符或損毀的資料', () => {
    expect(() => Dawg.fromJSON({ format: 'x' })).toThrow(TypeError)
    const data = Dawg.build(words).toJSON()
    expect(() => Dawg.fromJSON({ ...data, labels: `${data.labels}z` })).toThrow(RangeError)
  })

  it('性質測試：隨機詞庫的最小化結果仍然完全等價', () => {
    const random = createRandom(4242)
    for (let round = 0; round < 40; round++) {
      const vocabulary = [
        ...new Set(Array.from({ length: 60 }, () => randomString(random, ['a', 'b', 'n', 'u', 'l', ' '], 1, 6))),
      ]
      const dawg = Dawg.build(vocabulary)
      const sorted = [...vocabulary].sort()
      expect(dawg.words()).toEqual(sorted)
      sorted.forEach((word, rank) => expect(dawg.lookup(word)).toBe(rank))
      // 隨機的非詞不應被接受
      for (let k = 0; k < 20; k++) {
        const probe = randomString(random, ['a', 'b', 'n', 'u', 'l', ' '], 1, 6)
        expect(dawg.lookup(probe) >= 0).toBe(sorted.includes(probe))
      }
    }
  })
})

describe('FuzzyIndex 與詞圖', () => {
  const metric = createPazehKaxabuMetric()

  it('附帶資料靠完美雜湊對應，共用後綴也不會混淆', () => {
    const index = new FuzzyIndex(metric).addAll([
      ['atulan', 'A'],
      ['bintulan', 'B'],
      ['bintun', 'C'],
    ])
    expect(index.lookup('atulan')).toEqual(['A'])
    expect(index.lookup('bintulan')).toEqual(['B'])
    expect(index.lookup('bintun')).toEqual(['C'])
    expect(index.search('bintulan', { maxDistance: 0 })[0].payloads).toEqual(['B'])
  })

  it('凍結後再加詞會自動重建', () => {
    const index = new FuzzyIndex(metric).addAll([['alaw', 1]])
    expect(index.size).toBe(1)
    index.search('alaw') // 觸發建立詞圖
    index.add('alaw', 2)
    index.add('bintun', 3)
    expect(index.size).toBe(2)
    expect(index.lookup('alaw')).toEqual([1, 2])
    expect(index.search('bintul', { maxDistance: 0.5 })[0]).toMatchObject({ term: 'bintun', payloads: [3] })
  })

  it('序列化往返後搜尋結果相同', () => {
    const words = ['bintun', 'bintul', 'atun', 'a', 'alaw', 'baruzak binayu', 'akhéhan']
    const index = new FuzzyIndex(metric).addAll(words.map((w, k) => [w, { id: k }]))
    const restored = FuzzyIndex.deserialize(JSON.parse(JSON.stringify(index.serialize())), metric)
    expect(restored.size).toBe(index.size)
    expect(restored.terms).toEqual(index.terms)
    for (const q of ['bintul', 'alu', 'baruzakbinayu', 'akhehan', '']) {
      expect(restored.search(q, { maxDistance: 2 })).toEqual(index.search(q, { maxDistance: 2 }))
    }
  })

  it('序列化輸出與插入順序無關', () => {
    const words = ['bintun', 'bintul', 'atun', 'alaw']
    const a = new FuzzyIndex(metric).addAll(words.map((w) => [w, w]))
    const b = new FuzzyIndex(metric).addAll([...words].reverse().map((w) => [w, w]))
    expect(a.serialize()).toEqual(b.serialize())
  })

  it('拒絕格式不符的序列化資料', () => {
    expect(() => FuzzyIndex.deserialize({ format: 'x' }, metric)).toThrow(TypeError)
    const data = new FuzzyIndex(metric).addAll(['a']).serialize()
    expect(() => FuzzyIndex.deserialize({ ...data, version: 99 }, metric)).toThrow(RangeError)
  })
})
