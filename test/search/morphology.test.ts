/**
 * 搜尋引擎的構詞功能：自動拆解（去詞綴）與自動派生（還原詞綴）。
 * 詞綴規格是合成的，只用來驗證機制。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.ts'
import { SearchEngine, buildDerivationGraph, buildSearchIndex } from '../../src/search/index.ts'
import { PAZEH_PROFILE } from '../../packages/bcdp/test/fixtures/pazeh.ts'
import type { LanguageProfile, MorphologySpec } from '../../packages/bcdp/src/index.ts'
import type { CorpusRecord, Unit } from '../../src/schema/types.ts'

const MORPHOLOGY: MorphologySpec = {
  cost: 0.3,
  minStem: 3,
  prefixes: [{ form: 'mu', gloss: { 'zh-TW': '主事焦點', en: 'AF' } }, { form: 'pa' }, { form: 'minu' }],
  suffixes: [{ form: 'an' }],
  infixes: [{ form: 'in' }],
}

const rec = (localId: string, unit: Unit, text: string, zh: string, extra: Partial<CorpusRecord> = {}) =>
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

function engineWith(profile: LanguageProfile) {
  const built = buildSearchIndex({
    items: records.map((record) => ({ record, shard: 'all' })),
    groups: [],
    sourceIds: ['dict'],
    profile,
  })
  const data = JSON.parse(JSON.stringify(built))
  return new SearchEngine({ ...data, derivations: buildDerivationGraph(data) })
}

const withMorphology = engineWith({ ...PAZEH_PROFILE, morphology: MORPHOLOGY })
const without = engineWith(PAZEH_PROFILE)
const ids = (hits: Array<{doc: {id: string}}>) => hits.map((h) => h.doc.id)

describe('自動拆解（查衍生詞 → 找到詞根）', () => {
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

  it('精確模式不做自動拆解', () => {
    const res = withMorphology.search('mudaux', { fields: ['native'], fuzziness: 'exact' })
    expect(res.entries.some((h) => h.matchType === 'lemma')).toBe(false)
  })

  it('語言設定檔沒有 morphology 時完全沒有構詞命中', () => {
    const res = without.search('mudaux', { fields: ['native'] })
    expect(res.entries.some((h) => h.matchType === 'lemma')).toBe(false)
    expect(ids(res.entries)).not.toContain('dict:daux')
  })
})

describe('自動派生（查詞根 → 找到衍生詞）', () => {
  it('查 baket 找到中綴形式 binaket，排在詞根本身之後', () => {
    const res = withMorphology.search('baket', { fields: ['native'] })
    expect(ids(res.entries).slice(0, 2)).toEqual(['dict:baket', 'dict:binaket'])
    const hit = res.entries[1]
    expect(hit).toMatchObject({ kind: 'head', matchType: 'derived', distance: 0.3 })
    expect(hit.score).toBeGreaterThan(res.entries[0].score)
    expect(hit.analysis?.steps).toEqual([expect.objectContaining({ type: 'infix', form: 'in' })])
  })

  it('查詞根也找到含自動派生的例句（中綴形式，包含比對找不到）', () => {
    expect(ids(withMorphology.search('baket', { fields: ['native'] }).occurrences)).toContain('dict:s2')
    expect(ids(without.search('baket', { fields: ['native'] }).occurrences)).not.toContain('dict:s2')
  })

  it('自動派生必須正好由查詢衍生：查 bak 不會列出 binaket（它的詞幹是 baket）', () => {
    const res = withMorphology.search('bak', { fields: ['native'] })
    expect(ids(res.entries)).toContain('dict:baket')
    expect(ids(res.entries)).not.toContain('dict:binaket')
  })

  it('跨來源相近詞不含構詞命中', () => {
    expect(ids(withMorphology.neighbors('dict:baket'))).not.toContain('dict:binaket')
  })

  it('查詞根時，前綴衍生詞改標為自動派生（原本只是包含命中）', () => {
    const res = withMorphology.search('daux', { fields: ['native'] })
    const occ = res.occurrences.find((h) => h.doc.id === 'dict:s1')
    expect(occ?.matchType).toBe('derived')
    // mudaux 以 daux 結尾：沒有構詞規格時是結尾相符
    expect(without.search('daux', { fields: ['native'] }).occurrences.find((h) => h.doc.id === 'dict:s1')?.matchType).toBe('suffix')
  })
})

describe('第二版：派生詞列表與音變 ∘ 構詞的聯合搜尋', () => {
  it('自動拆解時列出辭典標註的派生詞，排在詞根本身之後', () => {
    const res = withMorphology.search('kinawas', { fields: ['native'] })
    const root = res.entries.find((h) => h.doc.id === 'dict:kawas')
    const child = res.entries.find((h) => h.doc.id === 'dict:mukawas')
    expect(root).toMatchObject({ matchType: 'lemma', kind: 'head' })
    expect(child).toMatchObject({ matchType: 'lemma', kind: 'root', term: 'kawas' })
    expect(child?.score).toBeGreaterThan((root as any).score)
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

  it('自動派生方向也涵蓋查詢的方言變體：查 daux 找到 mudox（經由 dox）', () => {
    const hit = withMorphology.search('daux', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:mudox')
    expect(hit?.matchType).toBe('derived')
    expect(hit?.analysis).toMatchObject({ stem: 'dox', variantOf: 'daux', variantDistance: 0.1, notes: [] })
    expect(hit?.analysis?.variantNotes?.map((n) => `${n.source}→${n.target}`)).toEqual(['au→o'])
  })

  it('已移除的 lemmaDistance 會得到清楚的錯誤（音變改以整個詞計算）', () => {
    expect(() => // 刻意帶已移除的欄位
      engineWith({ ...PAZEH_PROFILE, morphology: { ...MORPHOLOGY, lemmaDistance: 0 } as MorphologySpec })).toThrow(/lemmaDistance 已移除/)
  })
})

describe('環綴：兩側一起算一個步驟', () => {
  // 只有環綴 ta-…-aw、<in>…-an，沒有單獨的 ta-、-aw：只能以環綴分析
  const circ = engineWith({
    ...PAZEH_PROFILE,
    morphology: { ...MORPHOLOGY, prefixes: [{ form: 'mu' }], suffixes: [], circumfixes: [{ prefix: 'ta', suffix: 'aw', gloss: 'HORT' }, { infix: 'in', suffix: 'an' }] },
  })

  it('自動拆解：takitaaw → kita，一個步驟 0.3', () => {
    const hit = circ.search('takitaaw', { fields: ['native'] }).entries.find((h) => h.matchType === 'lemma' && h.term === 'kita')
    expect(hit?.distance).toBeCloseTo(0.3, 9)
    expect(hit?.analysis?.steps).toEqual([expect.objectContaining({ type: 'circumfix', form: 'ta…aw', suffix: 'aw', left: { type: 'prefix', form: 'ta' } })])
  })

  it('外面再加前綴、中綴式的環綴：mubinaketan → baket', () => {
    const hit = circ.search('mubinaketan', { fields: ['native'] }).entries.find((h) => h.matchType === 'lemma' && h.term === 'baket')
    expect(hit?.analysis?.steps.map((s) => s.form)).toEqual(['mu', 'in…an'])
  })

  it('自動派生：查 kita 找到 takitaaw，說明是環綴', () => {
    const hit = circ.search('kita', { fields: ['native'] }).entries.find((h) => h.term === 'takitaaw')
    expect(hit?.matchType).toBe('derived')
    expect(hit?.analysis?.steps.map((s) => s.form)).toEqual(['ta…aw'])
  })
})

describe('explainMorphology：實驗室用的構詞說明', () => {
  it('與搜尋的自動拆解命中一致（同一個總成本上限）；沒有構詞規格時為 null', () => {
    const hit = withMorphology.search('mudaux', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:daux')
    const e = withMorphology.explainMorphology('Mu-daux', 'daux') as any
    expect(e.query).toBe('mudaux')
    expect(e.hit.distance).toBe(hit?.analysis?.cost)
    expect(e.hit.steps.map((s: any) => s.form)).toEqual(hit?.analysis?.steps.map((s) => s.form))
    expect(structuredClone(e)).toEqual(e)
    expect(without.explainMorphology('mudaux', 'daux')).toBeNull()
  })
})

describe('同一個詞有多種命中方式：取排序分數較好的一種', () => {
  // 回歸：原本構詞命中遇到同一個詞的模糊命中一律捨棄。查詢夠長時門檻變大（7 字元 1.25），
  // 刪掉短前綴（p 1.0 ＋ 閃音規則 0.1…）就落在門檻內，最好的構詞分析反而被較差的模糊命中蓋掉
  const multi = (() => {
    // 自動派生由詞庫中的詞根往下找（自動派生圖），所以詞根本身要在詞庫中
    const list = [rec('razem', 'word', 'razem', '賽跑'), rec('daux', 'word', 'daux', '喝'), rec('daux2', 'word', 'dauxi', '喝吧')]
    const built = buildSearchIndex({
      items: list.map((record) => ({ record, shard: 'all' })),
      groups: [],
      sourceIds: ['dict'],
      profile: { ...PAZEH_PROFILE, morphology: { ...MORPHOLOGY, suffixes: [{ form: 'an' }, { form: 'i' }] } },
    })
    const data = JSON.parse(JSON.stringify(built))
    return new SearchEngine({ ...data, derivations: buildDerivationGraph(data) })
  })()

  it('詞根方向：查 parazem，razem 雖然也是模糊命中（1.2），仍以構詞命中（pa- ＋ razem）列出', () => {
    const res = multi.search('parazem', { fields: ['native'] })
    const hit = res.entries.find((h) => h.doc.id === 'dict:razem')
    expect(hit).toMatchObject({ matchType: 'lemma', term: 'razem' })
    expect(hit?.score).toBeLessThan(1.2)
    // 模糊命中清單不再列出它（改以構詞命中呈現）
    expect(res.terms.map((t) => t.term)).not.toContain('razem')
  })

  it('自動派生方向：查 daux，dauxi 雖然也是模糊命中（補一個字元 0.8），仍以自動派生列出', () => {
    const hit = multi.search('daux', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:daux2')
    expect(hit).toMatchObject({ matchType: 'derived', term: 'dauxi' })
  })

  it('完全相同的詞不會被構詞命中取代', () => {
    const hit = multi.search('dauxi', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:daux2')
    expect(hit).toMatchObject({ matchType: 'fuzzy', distance: 0 })
  })
})

describe('lemmaRulePenalty：既剝詞綴又改寫詞幹的自動拆解排在後面', () => {
  // masizaw 可以拆成 masi- ＋ zaw，zaw 套 z → d、w → u 就是 dau（0.1 ＋ 0.2，排序分數 0.7）；
  // 整詞只差一個沒有規則的 i → e 就是 masezaw（模糊 1.5）
  const list = [rec('masezaw', 'word', 'masezaw', '某詞'), rec('dau', 'word', 'dau', '另一個詞'), rec('daux', 'word', 'daux', '喝')]
  const engineFor = (lemmaRulePenalty?: number) => {
    const morphology: MorphologySpec = { cost: 0.1, minStem: 3, prefixes: [{ form: 'masi' }, { form: 'mu' }], ...(lemmaRulePenalty === undefined ? {} : { lemmaRulePenalty }) }
    const built = buildSearchIndex({ items: list.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology } })
    const data = JSON.parse(JSON.stringify(built))
    return new SearchEngine({ ...data, derivations: buildDerivationGraph(data) })
  }
  const order = (engine: SearchEngine, q: string) => ids(engine.search(q, { fields: ['native'], fuzziness: 'loose' }).entries)

  it('預設（0）時與以前相同：自動拆解的 dau 排在 masezaw 前面', () => {
    expect(order(engineFor(), 'masizaw').slice(0, 2)).toEqual(['dict:dau', 'dict:masezaw'])
  })

  it('加成之後 masezaw 排在前面；dau 仍然回傳，說明中的分析成本不變', () => {
    const engine = engineFor(5)
    const res = engine.search('masizaw', { fields: ['native'], fuzziness: 'loose' })
    expect(ids(res.entries).slice(0, 2)).toEqual(['dict:masezaw', 'dict:dau'])
    const dau = res.entries.find((h) => h.doc.id === 'dict:dau')
    expect(dau).toMatchObject({ matchType: 'lemma' })
    expect(dau?.analysis?.cost).toBeCloseTo(0.3)
    expect(dau?.score).toBeCloseTo(0.4 + 0.3 + 5 * 0.2)
  })

  it('詞幹與詞庫詞完全相同的分析不受影響', () => {
    const plain = engineFor().search('mudaux', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:daux')
    const penalized = engineFor(5).search('mudaux', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:daux')
    expect(penalized).toMatchObject({ matchType: 'lemma' })
    expect(penalized?.score).toBe(plain?.score)
  })
})
