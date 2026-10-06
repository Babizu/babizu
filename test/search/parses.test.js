/**
 * 拆解表（src/search/parses.js）的編碼與查詢：每個詞的拆法依成本排序、虛擬詞根、
 * 「BCDP 最好的命中不是拆法」的詞記下的成本（best），以及依模糊程度取拆法時從哪裡算起。
 * 與 BCDP、自動派生圖、一般搜尋的一致性在 test/pattern/search.test.js「拆解表」。
 */

import { describe, expect, it } from 'vitest'
import { DerivationGraph, encodeDerivations, soundOf } from '../../src/search/derivations.js'
import { encodeParses, ParseChart, PARSES_FORMAT_VERSION, parsedAnalysis } from '../../src/search/parses.js'

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

  it('自動派生圖：子詞的音變上限與路徑上限都扣掉詞根成本（childrenOf、descendants）', () => {
    // bakan → bak：步驟 0.1、音變 0.15、詞根成本 0.1，邊的成本 0.35
    const terms = ['bakan', 'bak']
    const data = encodeDerivations([{ word: 0, root: 1, analysis: { cost: 0.35, steps: /** @type {any[]} */ ([{ type: 'suffix', form: 'an', cost: 0.1 }]), notes: [] } }], terms.length)
    const graph = new DerivationGraph(data, terms, (root) => (root === 'bak' ? 0.1 : 0))
    const seed = [{ id: 1, distance: 0 }]
    // 音變 0.15 在上限 0.2 之內（不扣詞根成本時是 0.25，會被擋掉）
    expect(graph.childrenOf(seed, { maxPath: 1, maxSound: 0.2 }).map((r) => r.word)).toEqual([0])
    // 路徑上限 0.3：不含詞根成本的 0.25 在上限內（含它的 0.35 不在）；排名用的成本仍含它
    expect(graph.childrenOf(seed, { maxPath: 0.3, maxSound: 0.2 }).map((r) => [r.word, r.cost])).toEqual([[0, 0.35]])
    expect(graph.descendants(seed, 0.3).map((r) => [r.word, r.cost])).toEqual([[0, 0.35]])
    // 起點本身含詞根成本時（查詢拆到 bak，0.2 ＋ 0.1）也扣掉
    expect(graph.childrenOf([{ id: 1, distance: 0.3, rootCost: 0.1 }], { maxPath: 0.5, maxSound: 0.2 }).map((r) => r.word)).toEqual([0])
    // 兩層（bak → bakan → bakanan）：第一條邊不含詞根成本的 0.25 在上限內，走得到 bakan，才能再往下（0.25 ＋ 0.04）
    const deep = encodeDerivations(
      [
        { word: 0, root: 1, analysis: { cost: 0.04, steps: /** @type {any[]} */ ([{ type: 'suffix', form: 'an', cost: 0.04 }]), notes: [] } },
        { word: 1, root: 2, analysis: { cost: 0.35, steps: /** @type {any[]} */ ([{ type: 'suffix', form: 'an', cost: 0.1 }]), notes: [] } },
      ],
      3,
    )
    const deepGraph = new DerivationGraph(deep, ['bakanan', 'bakan', 'bak'], (root) => (root === 'bak' ? 0.1 : 0))
    expect(deepGraph.descendants([{ id: 2, distance: 0 }], 0.3).map((r) => r.word).sort()).toEqual([0, 1])
    // 沒有詞根成本的圖：音變 0.25 超過上限
    expect(new DerivationGraph(data, terms).childrenOf(seed, { maxPath: 1, maxSound: 0.2 })).toEqual([])
  })

  it('詞根音節數的成本（rootSyllableCost）不是音變：拆法與自動派生圖的音變都扣掉它', () => {
    const p = parsedAnalysis('kita', false, 0.4, /** @type {any} */ ([{ cost: 0.1 }]), 0.1)
    expect(p.sound).toBeCloseTo(0.2)
    expect(p.rootCost).toBe(0.1)
    expect(parsedAnalysis('kita', false, 0.4, /** @type {any} */ ([{ cost: 0.1 }])).sound).toBeCloseTo(0.3)
    expect(soundOf({ cost: 0.4, steps: [{ cost: 0.1 }] }, 0.1)).toBeCloseTo(0.2)
    // 拆解表依詞根算詞根成本（虛擬詞根是 0）
    const withCost = new ParseChart(data, TERMS, (root) => (root === 'usa' ? 0.1 : 0))
    expect(withCost.of(3).map((x) => [x.root, x.sound, x.rootCost ?? 0])).toEqual([
      ['ausay', 0, 0],
      ['usa', 0.1, 0.1],
    ])
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
