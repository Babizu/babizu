/**
 * 拆解表（src/search/parses.js）的編碼與查詢：每個詞的拆法依成本排序、虛擬詞根、
 * 「BCDP 最好的命中不是拆法」的詞記下的成本（best），以及依模糊程度取拆法時從哪裡算起。
 * 與 BCDP、自動派生圖、一般搜尋的一致性在 test/pattern/search.test.js「拆解表」。
 */

import { describe, expect, it } from 'vitest'
import { encodeParses, ParseChart, PARSES_FORMAT_VERSION } from '../../src/search/parses.js'

const TERMS = ['abak', 'barak', 'rak', 'mausay', 'usa']
/** @param {number} cost @param {Array<{type: string, form: string, cost: number}>} steps */
const analysis = (cost, steps) => ({ cost, steps: /** @type {any[]} */ (steps), notes: [] })
const A = { type: 'prefix', form: 'a', cost: 0.1 }
const PA = { type: 'prefix', form: 'pa', cost: 0.1 }
const MA = { type: 'prefix', form: 'ma', cost: 0.1 }

// abak：唯一的拆法是 a-pa-rak（0.55，含音變 0.35），BCDP 最好的命中是 a- ＋ barak（0.25，詞根比詞長，不是拆法）
// mausay：詞庫詞根 usa（0.3）與虛擬詞根 ausay（0.1）
const data = encodeParses(
  [
    { word: 0, root: 2, analysis: analysis(0.55, [A, PA]) },
    { word: 3, root: 4, analysis: analysis(0.3, [MA]) },
  ],
  [{ word: 3, root: 'ausay', analysis: { cost: 0.1, steps: /** @type {any[]} */ ([{ type: 'prefix', form: 'm', cost: 0.1 }]), notes: [{ op: 'x' }] } }],
  [[0, 0.25]],
  TERMS.length,
)
const chart = new ParseChart(data, TERMS)

describe('拆解表', () => {
  it('編碼：與 derivations.json 同一種（步驟與分析去重、虛擬詞根接在詞編號之後），不存音變說明，另有 best', () => {
    expect(data.version).toBe(PARSES_FORMAT_VERSION)
    expect(data.virtual).toEqual(['ausay'])
    expect(data.analyses.every(([, , notes]) => notes.length === 0)).toBe(true)
    expect(data.best).toEqual([0, 0.25])
  })

  it('每個詞的拆法依成本排序；sound 是成本扣掉各步驟的成本', () => {
    expect(chart.of(3).map((p) => [p.root, p.virtual, p.cost])).toEqual([
      ['ausay', true, 0.1],
      ['usa', false, 0.3],
    ])
    const [rak] = chart.of(0)
    expect(rak).toMatchObject({ root: 'rak', virtual: false, cost: 0.55 })
    expect(rak.sound).toBeCloseTo(0.35)
    expect(chart.of(1)).toEqual([])
  })

  it('BCDP 在詞庫中最好的命中：不是拆法時是那個命中（abak 0.25）；不含虛擬詞根（mausay 是 usa 0.3，不是虛擬詞根的 0.1）', () => {
    expect(chart.lexicalBestOf(0)).toBe(0.25)
    expect(chart.lexicalBestOf(3)).toBe(0.3)
    expect(chart.lexicalBestOf(1)).toBe(Infinity)
    // 沒有「混在一起的最好成本」：虛擬詞根的成本與 BCDP 的不能比
    expect(/** @type {any} */ (chart).bestOf).toBeUndefined()
  })

  it('格式版本或詞數不符時拒絕', () => {
    expect(() => new ParseChart({ ...data, version: 0 }, TERMS)).toThrow(/格式版本/)
    expect(() => new ParseChart(data, TERMS.slice(1))).toThrow(/詞數/)
  })
})
