import { describe, expect, it } from 'vitest'
import { WeightedEditDistance, RuleSet } from '../../src/fuzzy/index.js'
import { createPazehKaxabuMetric } from '../fixtures/pazeh.js'

describe('基本成本（無規則）', () => {
  const metric = new WeightedEditDistance()

  it('相同字串距離為 0', () => {
    expect(metric.distance('lasu', 'lasu')).toBe(0)
    expect(metric.distance('', '')).toBe(0)
  })

  it('替換 1.5、刪除 1.0、插入 0.8', () => {
    expect(metric.distance('abc', 'abd')).toBe(1.5)
    expect(metric.distance('abc', 'ab')).toBe(1) // 查詢多一字：刪除
    expect(metric.distance('ab', 'abc')).toBe(0.8) // 查詢少一字：插入
  })

  it('「刪除＋插入」比替換便宜時選前者', () => {
    const cheapIndel = new WeightedEditDistance({ costs: { substitute: 3, delete: 1, insert: 1 } })
    expect(cheapIndel.distance('a', 'b')).toBe(2)
  })

  it('空白的插入、刪除、替換都是 0.1', () => {
    expect(metric.distance('baruzakbinayu', 'baruzak binayu')).toBe(0.1)
    expect(metric.distance('baruzak binayu', 'baruzakbinayu')).toBe(0.1)
    expect(metric.distance('ab cd', 'abxcd')).toBe(0.1)
  })

  it('空字串邊界', () => {
    expect(metric.distance('', 'abc')).toBe(2.4)
    expect(metric.distance('abc', '')).toBe(3)
  })

  it('成本必須是非負有限數', () => {
    expect(() => new WeightedEditDistance({ costs: { substitute: -1 } })).toThrow(RangeError)
  })
})

describe('巴宰–噶哈巫語預設規則：需求文件中的例子', () => {
  const metric = createPazehKaxabuMetric()

  it.each([
    ['semer', 'semee', '閃音 er ↔ ee'],
    ['rapay', 'apay', 'r 脫落'],
    ['raulu', 'laulu', 'r ↔ l'],
    ['bintul', 'bintun', '詞尾 l ↔ n'],
    ['atul', 'atun', '詞尾 l ↔ n'],
    ['aruk', 'awk', '滑音 aru ↔ aw'],
    ['say', 'tshay', '特例'],
    ['semeh', 'seme', '詞尾 h 脫落'],
  ])('%s ↔ %s = 0.1（%s）', (a, b) => {
    expect(metric.distance(a, b)).toBe(0.1)
    expect(metric.distance(b, a)).toBe(0.1)
  })

  it('lasu、alaw 本身不變', () => {
    expect(metric.distance('lasu', 'lasu')).toBe(0)
    expect(metric.distance('alaw', 'alaw')).toBe(0)
  })

  it('非詞尾的 l 不適用 l → n，只能一般替換', () => {
    expect(metric.distance('alaw', 'anaw')).toBe(1.5)
  })

  it('詞尾規則在片語中的詞邊界（空白前）也適用', () => {
    expect(metric.distance('bintul a', 'bintun a')).toBe(0.1)
    // l→n（詞尾）0.1 + 刪空白 0.1 + 刪 a 1.0
    expect(metric.distance('bintul a', 'bintun')).toBe(1.2)
  })

  it('規則不可重疊串接：同一片段只能套一條規則', () => {
    // r→l 與 l→n（詞尾）不能串成 r→n
    expect(metric.distance('bintur', 'bintun')).toBeGreaterThan(0.2)
  })

  it('去附加符號但保留 é；NFC 與 NFD 結果相同', () => {
    expect(metric.distance('Tūhūbū́ss', 'tuhubuss')).toBe(0)
    expect(metric.distance('akhéhan', 'akhéhan')).toBe(0)
    expect(metric.distance('akhéhan', 'akhehan')).toBe(0.1) // e ↔ é
  })

  it('ǝ (U+01DD) 與 ə (U+0259) 視為同一字元', () => {
    expect(metric.distance('bǝkǝts', 'bəkəts')).toBe(0)
  })
})

describe('位置限制', () => {
  const rules = new RuleSet()
    .add('x', 'y', 0.1, { position: 'initial' })
    .add('q', 'w', 0.1, { position: 'final' })
  const metric = new WeightedEditDistance({ rules })

  it('initial 只在詞首（字串開頭或空白之後）', () => {
    expect(metric.distance('xa', 'ya')).toBe(0.1)
    expect(metric.distance('ax', 'ay')).toBe(1.5)
    expect(metric.distance('a xa', 'a ya')).toBe(0.1)
  })

  it('final 只在詞尾（字串結尾或空白之前）', () => {
    expect(metric.distance('aq', 'aw')).toBe(0.1)
    expect(metric.distance('qa', 'wa')).toBe(1.5)
    expect(metric.distance('aq b', 'aw b')).toBe(0.1)
  })

  it('X 與 Y 兩側都必須在詞尾', () => {
    // X 的 q 在詞尾，但 Y 的 w 後面還有 b：只能替換 q→w 再插入 b
    expect(metric.distance('aq', 'awb')).toBe(1.5 + 0.8)
  })
})

describe('雙向規則', () => {
  it('預設自動補反向規則', () => {
    const metric = new WeightedEditDistance({ rules: [['ab', 'c', 0.2]] })
    expect(metric.distance('ab', 'c')).toBe(0.2)
    expect(metric.distance('c', 'ab')).toBe(0.2)
  })

  it('bidirectional: false 時只有單向', () => {
    const rules = new RuleSet().add('ab', 'c', 0.2, { bidirectional: false })
    const metric = new WeightedEditDistance({ rules })
    expect(metric.distance('ab', 'c')).toBe(0.2)
    expect(metric.distance('c', 'ab')).toBe(1.5 + 0.8)
  })
})

describe('正規化距離', () => {
  const metric = createPazehKaxabuMetric()

  it('max／sum／query 策略', () => {
    expect(metric.normalizedDistance('bintul', 'bintun', 'max')).toBeCloseTo(0.1 / 6)
    expect(metric.normalizedDistance('ab', 'abcd', 'max')).toBeCloseTo(1.6 / 4)
    expect(metric.normalizedDistance('ab', 'abcd', 'sum')).toBeCloseTo((2 * 1.6) / 6)
    expect(metric.normalizedDistance('ab', 'abcd', 'query')).toBeCloseTo(1.6 / 2)
  })

  it('自訂策略', () => {
    const d = metric.normalizedDistance('ab', 'abcd', { score: (dist, n, m) => dist / (n * m) })
    expect(d).toBeCloseTo(1.6 / 8)
  })

  it('未知策略會丟出錯誤', () => {
    expect(() => metric.normalizedDistance('a', 'b', 'nope')).toThrow(RangeError)
  })
})
