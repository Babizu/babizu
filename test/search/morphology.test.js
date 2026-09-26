/**
 * 搜尋引擎的構詞功能：詞根相符（去詞綴）與衍生形（還原詞綴）。
 * 詞綴規格是合成的，只用來驗證機制。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.js'
import { SearchEngine, buildSearchIndex } from '../../src/search/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

const MORPHOLOGY = {
  cost: 0.3,
  minStem: 3,
  prefixes: [{ form: 'mu', gloss: { 'zh-TW': '主事焦點', en: 'AF' } }, { form: 'pa' }, { form: 'minu' }],
  suffixes: [{ form: 'an' }],
  infixes: [{ form: 'in' }],
}

/** @param {string} localId @param {string} unit @param {string} text @param {string} zh */
const rec = (localId, unit, text, zh, extra = {}) =>
  createRecord(
    { source: 'dict', localId, unit, text, citation: createCitation(`dict ${localId}`) },
    { senses: [createSense({ zh })], ...extra },
  )

const records = [
  rec('daux', 'word', 'daux', '喝'),
  rec('baket', 'word', 'baket', '打'),
  rec('binaket', 'word', 'binaket', '被打了'), // 沒有標註衍生關係：要靠構詞分析連起來
  rec('patukuan', 'word', 'patukuan', '讓…看'),
  rec('tuku', 'word', 'tuku', '看'),
  rec('kawas', 'word', 'kawas', '天'),
  rec('mukawas', 'word', 'mukawas', '天亮', {
    morphology: { formType: 'free', segmentation: null, gloss: null, derivedFrom: [{ relation: '<', text: 'kawas-' }] },
  }),
  rec('dox', 'word', 'dox', '喝（方言）'),
  rec('mudox', 'word', 'mudox', '喝了（方言）'),
  rec('s1', 'sentence', 'yaku ka mudaux dalum.', '我喝水'),
  rec('s2', 'sentence', 'binaket ni yaku.', '被我打了'),
  rec('kita', 'word', 'kita', '看'),
  rec('takitaaw', 'word', 'takitaaw', '看吧（勸說）'),
]

/** @param {object} profile */
function engineWith(profile) {
  const built = buildSearchIndex({
    items: records.map((record) => ({ record, shard: 'all' })),
    groups: [],
    sourceIds: ['dict'],
    profile,
  })
  return new SearchEngine(JSON.parse(JSON.stringify(built)))
}

const withMorphology = engineWith({ ...PAZEH_PROFILE, morphology: MORPHOLOGY })
const without = engineWith(PAZEH_PROFILE)
const ids = (/** @type {Array<{doc: {id: string}}>} */ hits) => hits.map((h) => h.doc.id)

describe('詞根相符（查衍生詞 → 找到詞根）', () => {
  it('查 mudaux 找到詞根 daux，附上構詞分析', () => {
    const res = withMorphology.search('mudaux', { fields: ['native'] })
    const hit = res.entries.find((h) => h.doc.id === 'dict:daux')
    expect(hit).toMatchObject({ matchType: 'lemma', term: 'daux', distance: 0.3 })
    expect(hit?.analysis?.steps).toEqual([expect.objectContaining({ type: 'prefix', form: 'mu' })])
    // 句中完全相同的詞仍排在前面（例句區）
    expect(ids(res.occurrences)).toContain('dict:s1')
  })

  it('多層詞綴：patukuan → tuku', () => {
    const hit = withMorphology.search('mupatukuan', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:tuku')
    expect(hit?.matchType).toBe('lemma')
    expect(hit?.analysis?.steps.map((s) => s.form).sort()).toEqual(['an', 'mu', 'pa'])
  })

  it('精確模式不做詞根相符', () => {
    const res = withMorphology.search('mudaux', { fields: ['native'], fuzziness: 'exact' })
    expect(res.entries.some((h) => h.matchType === 'lemma')).toBe(false)
  })

  it('語言設定檔沒有 morphology 時完全沒有構詞命中', () => {
    const res = without.search('mudaux', { fields: ['native'] })
    expect(res.entries.some((h) => h.matchType === 'lemma')).toBe(false)
    expect(ids(res.entries)).not.toContain('dict:daux')
  })
})

describe('衍生形（查詞根 → 找到衍生詞）', () => {
  it('查 baket 找到中綴形式 binaket，排在詞根本身之後', () => {
    const res = withMorphology.search('baket', { fields: ['native'] })
    expect(ids(res.entries).slice(0, 2)).toEqual(['dict:baket', 'dict:binaket'])
    const hit = res.entries[1]
    expect(hit).toMatchObject({ kind: 'head', matchType: 'derived', distance: 0.3 })
    expect(hit.score).toBeGreaterThan(res.entries[0].score)
    expect(hit.analysis?.steps).toEqual([expect.objectContaining({ type: 'infix', form: 'in' })])
  })

  it('查詞根也找到含衍生形的例句（中綴形式，包含比對找不到）', () => {
    expect(ids(withMorphology.search('baket', { fields: ['native'] }).occurrences)).toContain('dict:s2')
    expect(ids(without.search('baket', { fields: ['native'] }).occurrences)).not.toContain('dict:s2')
  })

  it('衍生形必須正好由查詢衍生：查 bak 不會列出 binaket（它的詞幹是 baket）', () => {
    const res = withMorphology.search('bak', { fields: ['native'] })
    expect(ids(res.entries)).toContain('dict:baket')
    expect(ids(res.entries)).not.toContain('dict:binaket')
  })

  it('跨來源相近詞不含構詞命中', () => {
    expect(ids(withMorphology.neighbors('dict:baket'))).not.toContain('dict:binaket')
  })

  it('查詞根時，前綴衍生詞改標為衍生形（原本只是包含命中）', () => {
    const res = withMorphology.search('daux', { fields: ['native'] })
    const occ = res.occurrences.find((h) => h.doc.id === 'dict:s1')
    expect(occ?.matchType).toBe('derived')
    expect(without.search('daux', { fields: ['native'] }).occurrences.find((h) => h.doc.id === 'dict:s1')?.matchType).toBe('substring')
  })
})

describe('第二版：派生詞列表與音變 ∘ 構詞的聯合搜尋', () => {
  it('詞根相符時列出辭典標註的派生詞，排在詞根本身之後', () => {
    const res = withMorphology.search('kinawas', { fields: ['native'] })
    const root = res.entries.find((h) => h.doc.id === 'dict:kawas')
    const child = res.entries.find((h) => h.doc.id === 'dict:mukawas')
    expect(root).toMatchObject({ matchType: 'lemma', kind: 'head' })
    expect(child).toMatchObject({ matchType: 'lemma', kind: 'root', term: 'kawas' })
    expect(child?.score).toBeGreaterThan(/** @type {any} */ (root).score)
  })

  it('詞幹帶方言音變：minudox → daux（o → au），說明標出音變落在詞幹', () => {
    const hit = withMorphology.search('minudox', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:daux')
    expect(hit?.matchType).toBe('lemma')
    expect(hit?.analysis).toMatchObject({ stem: 'daux', cost: 0.4 })
    expect(hit?.analysis?.steps.map((s) => s.form)).toEqual(['minu'])
    expect(hit?.analysis?.notes?.map((n) => `${n.source}→${n.target}@${n.where}`)).toEqual(['o→au@stem'])
  })

  it('詞綴本身帶方言音變：minedaux 的 mine- 對應 minu-，說明標出音變落在前綴', () => {
    const hit = withMorphology.search('minedaux', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:daux')
    expect(hit?.matchType).toBe('lemma')
    expect(hit?.analysis?.steps[0]).toMatchObject({ type: 'prefix', form: 'minu' })
    expect(hit?.analysis?.notes?.map((n) => `${n.source}→${n.target}@${n.where}`)).toEqual(['e→u@prefix'])
  })

  it('衍生形方向也涵蓋查詢的方言變體：查 daux 找到 mudox（經由 dox）', () => {
    const hit = withMorphology.search('daux', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:mudox')
    expect(hit?.matchType).toBe('derived')
    expect(hit?.analysis).toMatchObject({ stem: 'dox', variantOf: 'daux', variantDistance: 0.1 })
    expect(hit?.analysis?.notes?.map((n) => `${n.source}→${n.target}@${n.where}`)).toEqual(['au→o@stem'])
  })

  it('已移除的 lemmaDistance 會得到清楚的錯誤（音變改以整個詞計算）', () => {
    expect(() => engineWith({ ...PAZEH_PROFILE, morphology: { ...MORPHOLOGY, lemmaDistance: 0 } })).toThrow(/lemmaDistance 已移除/)
  })
})

describe('環綴：兩側一起算一個步驟', () => {
  // 只有環綴 ta-…-aw、<in>…-an，沒有單獨的 ta-、-aw：只能以環綴分析
  const circ = engineWith({
    ...PAZEH_PROFILE,
    morphology: { ...MORPHOLOGY, prefixes: [{ form: 'mu' }], suffixes: [], circumfixes: [{ prefix: 'ta', suffix: 'aw', gloss: 'HORT' }, { infix: 'in', suffix: 'an' }] },
  })

  it('詞根相符：takitaaw → kita，一個步驟 0.3', () => {
    const hit = circ.search('takitaaw', { fields: ['native'] }).entries.find((h) => h.matchType === 'lemma' && h.term === 'kita')
    expect(hit?.distance).toBeCloseTo(0.3, 9)
    expect(hit?.analysis?.steps).toEqual([expect.objectContaining({ type: 'circumfix', form: 'ta…aw', suffix: 'aw', left: { type: 'prefix', form: 'ta' } })])
  })

  it('外面再加前綴、中綴式的環綴：mubinaketan → baket', () => {
    const hit = circ.search('mubinaketan', { fields: ['native'] }).entries.find((h) => h.matchType === 'lemma' && h.term === 'baket')
    expect(hit?.analysis?.steps.map((s) => s.form)).toEqual(['mu', 'in…an'])
  })

  it('衍生形：查 kita 找到 takitaaw，說明是環綴', () => {
    const hit = circ.search('kita', { fields: ['native'] }).entries.find((h) => h.term === 'takitaaw')
    expect(hit?.matchType).toBe('derived')
    expect(hit?.analysis?.steps.map((s) => s.form)).toEqual(['ta…aw'])
  })
})

describe('explainMorphology：實驗室用的構詞說明', () => {
  it('與搜尋的詞根相符命中一致（同一個總成本上限）；沒有構詞規格時為 null', () => {
    const hit = withMorphology.search('mudaux', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:daux')
    const e = /** @type {any} */ (withMorphology.explainMorphology('Mu-daux', 'daux'))
    expect(e.query).toBe('mudaux')
    expect(e.hit.distance).toBe(hit?.analysis?.cost)
    expect(e.hit.steps.map((/** @type {any} */ s) => s.form)).toEqual(hit?.analysis?.steps.map((s) => s.form))
    expect(structuredClone(e)).toEqual(e)
    expect(without.explainMorphology('mudaux', 'daux')).toBeNull()
  })
})
