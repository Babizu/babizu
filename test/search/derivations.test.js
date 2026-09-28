/**
 * 自動派生圖（src/search/derivations.js）：建置時由 BCDP 求每個詞最好的詞根，查詢時由詞根往下找自動派生形。
 * 資料是合成的，仿照 sungut（橋）→ pusungut（造橋）→ pausunguday（將要造橋；只出現在例句中）。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.js'
import { buildDerivationGraph, buildSearchIndex, createDerivationAnalyzer, DerivationGraph, SearchEngine } from '../../src/search/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

const MORPHOLOGY = {
  cost: 0.3,
  minStem: 3,
  prefixes: [{ form: 'pu' }, { form: 'ma' }],
  suffixes: [{ form: 'ay' }, { form: 'an' }],
  infixes: [{ form: 'a' }],
  alternations: [{ underlying: 't', surface: 'd', position: 'final', cost: 0.05 }],
}

/** @param {string} localId @param {string} unit @param {string} text */
const rec = (localId, unit, text) => createRecord({ source: 'dict', localId, unit, text, citation: createCitation(`dict ${localId}`) }, { senses: [createSense({ zh: text })] })

const records = [
  rec('sungut', 'word', 'sungut'),
  rec('pusungut', 'word', 'pusungut'),
  rec('s1', 'sentence', 'ini haw isia pausunguday'),
  rec('s2', 'sentence', 'masungut lia'),
  rec('baket', 'word', 'baket'),
  // 兩個詞根都在範圍內：pusungut ＋ -an（0.3）、sungut ＋ pu- ＋ -an（0.6）
  rec('pusungutan', 'word', 'pusungutan'),
]

/** @param {object} profile */
function build(profile) {
  const built = JSON.parse(JSON.stringify(buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile })))
  return { built, derivations: buildDerivationGraph(built) }
}

const { built, derivations } = build({ ...PAZEH_PROFILE, morphology: MORPHOLOGY })
const engine = new SearchEngine({ ...built, derivations })
const terms = engine.index.terms
/** 圖的邊：「詞 → 詞根 成本」 */
const edges = (() => {
  /** @type {string[]} */
  const out = []
  for (let k = 0, word = 0; k < derivations.edges.length; k += 3) {
    word += derivations.edges[k]
    out.push(`${terms[word]} → ${terms[derivations.edges[k + 1]]} ${derivations.analyses[derivations.edges[k + 2]][0]}`)
  }
  return out
})()

describe('建置：每個詞連到 BCDP 求得的最好詞根', () => {
  it('pausunguday 的最好詞根是 pusungut（<a>、-ay、t → d），不是 sungut；pusungut 連到 sungut', () => {
    expect(edges).toContain('pausunguday → pusungut 0.65')
    expect(edges).toContain('pusungut → sungut 0.3')
    expect(edges.some((e) => e.startsWith('pausunguday → sungut'))).toBe(false)
  })

  it('只取最好的詞根：pusungutan 連到 pusungut，不直接連到 sungut（查 sungut 時經 pusungut 走到）', () => {
    expect(edges.filter((e) => e.startsWith('pusungutan →'))).toEqual(['pusungutan → pusungut 0.3'])
    const hit = engine.search('sungut', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:pusungutan')
    expect(hit).toMatchObject({ matchType: 'derived', distance: 0.6 })
    expect(hit?.analysis?.stem).toBe('pusungut')
  })

  it('每條邊都是 BCDP 對那個詞最好的分析，而且詞根比詞短（所以沒有循環）', () => {
    const analyzer = createDerivationAnalyzer(built)
    const analyzed = analyzer.analyze()
    expect(analyzed.length).toBe(edges.length)
    for (const { word, root, analysis } of analyzed) {
      expect(Array.from(terms[root]).length).toBeLessThan(Array.from(terms[word]).length)
      // 成本＝步驟成本＋音變說明的成本（說明與成本一致）
      const sum = analysis.steps.reduce((s, x) => s + x.cost, 0) + analysis.notes.reduce((s, x) => s + x.cost, 0)
      expect(sum).toBeCloseTo(analysis.cost, 9)
    }
    // 切塊計算與一次算完相同（網站建置平行計算時依詞編號接起來）
    const half = Math.floor(analyzer.count / 2)
    expect([...analyzer.analyze(0, half), ...analyzer.analyze(half)]).toEqual(analyzed)
  })

  it('同樣的步驟與分析只存一次', () => {
    expect(new Set(derivations.steps.map((s) => JSON.stringify(s))).size).toBe(derivations.steps.length)
    expect(new Set(derivations.analyses.map((a) => JSON.stringify(a))).size).toBe(derivations.analyses.length)
  })

  it('沒有構詞規格時是空的圖', () => {
    const plain = build(PAZEH_PROFILE)
    expect(plain.derivations.edges).toEqual([])
    expect(new SearchEngine({ ...plain.built, derivations: plain.derivations }).derivations).toBeNull()
  })

  it('格式版本或詞數不符時要求重新建置', () => {
    expect(() => new DerivationGraph({ ...derivations, version: 0 }, terms)).toThrow(/重新建置/)
    expect(() => new DerivationGraph(derivations, terms.slice(1))).toThrow(/重新建置/)
  })
})

describe('查詢：由詞根往下走', () => {
  it('查 sungut 找到只出現在例句中的 pausunguday（經 pusungut），分數是兩條邊相加', () => {
    const res = engine.search('sungut', { fields: ['native'] })
    const occ = res.occurrences.find((o) => o.doc.id === 'dict:s1')
    expect(occ?.matchType).toBe('derived')
    const m = occ?.matches[0]
    expect(m).toMatchObject({ word: 'sungut', term: 'pausunguday', matchType: 'derived', distance: 0.95 })
    expect(m?.analysis).toMatchObject({ stem: 'pusungut', cost: 0.95 })
    expect(m?.analysis?.steps.map((s) => s.form)).toEqual(['a', 'ay'])
    expect(m?.analysis?.chain).toEqual([expect.objectContaining({ term: 'pusungut', stem: 'sungut', cost: 0.3 })])
    // 說明以查詢（衍生詞）的角度寫：詞中的 d 對應底層的 t
    expect(m?.analysis?.notes?.map((n) => `${n.source}→${n.target}`)).toEqual(['d→t'])
  })

  it('直接的自動派生形沒有 chain；詞條與例句都找得到', () => {
    const res = engine.search('sungut', { fields: ['native'] })
    const hit = res.entries.find((h) => h.doc.id === 'dict:pusungut')
    expect(hit).toMatchObject({ matchType: 'derived', distance: 0.3 })
    expect(hit?.analysis?.chain).toBeUndefined()
    expect(res.occurrences.find((o) => o.doc.id === 'dict:s2')?.matches[0]).toMatchObject({ term: 'masungut', matchType: 'derived' })
  })

  it('路徑成本不超過上限；起點本身不算自動派生形', () => {
    const graph = /** @type {DerivationGraph} */ (engine.derivations)
    const id = (/** @type {string} */ t) => engine.index.dawg.lookup(t)
    const all = graph.descendants([{ id: id('sungut'), distance: 0 }]).map((r) => terms[r.word])
    expect(all).toContain('pausunguday')
    expect(all).not.toContain('sungut')
    // 兩條邊（0.3、0.65）各自都在 0.8 之內，加起來超過
    expect(graph.descendants([{ id: id('sungut'), distance: 0 }], 0.8).map((r) => terms[r.word])).not.toContain('pausunguday')
  })

  it('寬鬆：查詢的相近寫法也當起點（sugut 經 sungut）；標準只用方言變體', () => {
    const find = (/** @type {'normal' | 'loose'} */ fuzziness) =>
      engine.search('sugut', { fields: ['native'], fuzziness }).occurrences.find((o) => o.doc.id === 'dict:s1')?.matches[0]
    expect(find('normal')).toBeUndefined()
    const m = find('loose')
    expect(m?.analysis).toMatchObject({ variantOf: 'sugut', stem: 'pusungut' })
    expect(m?.analysis?.variantNotes?.length).toBeGreaterThan(0)
    expect(m?.distance).toBeCloseTo(/** @type {number} */ (m?.analysis?.variantDistance) + 0.95, 9)
  })

  it('沒有自動派生圖時不找自動派生形', () => {
    const bare = new SearchEngine(built)
    expect(bare.search('sungut', { fields: ['native'] }).occurrences.some((o) => o.matchType === 'derived')).toBe(false)
  })
})

describe('例句的命中說明', () => {
  it('每個查詢詞一個命中，模糊命中附上對齊；多詞查詢各自一個', () => {
    const two = engine.search('ini pausungudai', { fields: ['native'] }).occurrences.find((o) => o.doc.id === 'dict:s1')
    expect(two?.matches.map((m) => m.word)).toEqual(['ini', 'pausungudai'])
    const fuzzy = two?.matches[1]
    expect(fuzzy).toMatchObject({ term: 'pausunguday', matchType: 'fuzzy' })
    expect(fuzzy?.alignment?.length).toBeGreaterThan(0)
  })
})

/** 另建一個小引擎（資料與規格各自獨立，不影響上面的圖） @param {any[]} list @param {object} morphology @param {any[]} [groups] */
function engineOf(list, morphology, groups = []) {
  const data = JSON.parse(JSON.stringify(buildSearchIndex({ items: list.map((record) => ({ record, shard: 'all' })), groups, sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology } })))
  return new SearchEngine({ ...data, derivations: buildDerivationGraph(data) })
}

describe('構詞文法：p<a>u-…-ay 是一個組合規則（pu ＋ PROG ＋ IRR），不是兩個獨立的步驟', () => {
  const GRAMMAR = {
    cost: 0.2,
    minStem: 3,
    morphemes: [
      { id: 'PU', type: 'prefix', form: 'pu' },
      { id: 'PROG', type: 'infix', form: 'a' },
      { id: 'IRR', type: 'suffix', form: 'ay' },
    ],
    constructions: [{ id: 'PU.IRR', sequence: ['PU', 'PROG', 'IRR'] }],
    alternations: [{ underlying: 't', surface: 'd', position: 'final', cost: 0.05 }],
  }
  const g = engineOf([rec('sungut', 'word', 'sungut'), rec('pusungut', 'word', 'pusungut'), rec('s1', 'sentence', 'ini haw isia pausunguday')], GRAMMAR)

  it('pausunguday 直接連到 sungut：一個步驟，由 pu、<a>、-ay 三個詞素構成', () => {
    const m = g.search('sungut', { fields: ['native'] }).occurrences.find((o) => o.doc.id === 'dict:s1')?.matches[0]
    expect(m?.analysis?.stem).toBe('sungut')
    expect(m?.analysis?.chain).toBeUndefined()
    expect(m?.analysis?.steps.map((s) => (s.parts ?? []).map((p) => `${p.id}=${p.form}`).join('+'))).toEqual(['PU=pu+PROG=a+IRR=ay'])
    // 一個組合規則（0.2）＋ 詞根末的 t 在後綴前濁化（0.05）
    expect(m?.analysis?.cost).toBeCloseTo(0.25, 9)
  })
})

describe('例句：辭典列在詞條下的派生詞（辭典標註，不是自動派生）', () => {
  const withRoot = (/** @type {string} */ localId, /** @type {string} */ text, /** @type {string} */ root) =>
    createRecord(
      { source: 'dict', localId, unit: 'word', text, citation: createCitation(`dict ${localId}`) },
      { senses: [createSense({ zh: text })], morphology: { formType: 'free', segmentation: null, gloss: null, derivedFrom: [{ relation: '<', text: root }] } },
    )
  const d = engineOf(
    [rec('usa', 'word', 'usa'), withRoot('mukusa', 'mukusa', 'usa'), rec('s1', 'sentence', 'dusa a batan'), rec('s2', 'sentence', 'mukusa di binayu')],
    { cost: 0.3, minStem: 3, prefixes: [{ form: 'mu' }] },
  )

  it('查 usa：含 mukusa 的例句標為「辭典：衍生自 usa」，分數是 usa 的分數加一層，排在只是包含 usa 的 dusa 之前', () => {
    const res = d.search('usa', { fields: ['native'] })
    const ids = res.occurrences.map((o) => o.doc.id)
    expect(ids.indexOf('dict:s2')).toBeLessThan(ids.indexOf('dict:s1'))
    const o = res.occurrences.find((x) => x.doc.id === 'dict:s2')
    expect(o?.matches[0]).toMatchObject({ word: 'usa', term: 'usa', token: 'mukusa', kind: 'root', matchType: 'fuzzy' })
    expect(o?.score).toBeCloseTo(0.1, 9)
    expect(o?.terms).toEqual(['mukusa'])
  })

  it('只從寫法與查詢相同的詞條展開：查相近寫法 uza（s → z）時，mukusa 不算辭典派生詞', () => {
    const o = d.search('uza', { fields: ['native'] }).occurrences.find((x) => x.doc.id === 'dict:s2')
    expect(o?.matches.some((m) => m.kind === 'root') ?? false).toBe(false)
  })
})

describe('開頭相符又能自動派生的詞：附上派生的說明，分數取兩者較好的', () => {
  const p = engineOf([rec('sungut', 'word', 'sungut'), rec('sungutan', 'word', 'sungutan')], { cost: 0.3, minStem: 3, suffixes: [{ form: 'an' }] })

  it('查 sungut：sungutan 以自動派生（sungut ＋ -an）呈現，分數是開頭相符的 0.45（比自動派生的 0.7 好）', () => {
    const hit = p.search('sungut', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:sungutan')
    expect(hit?.matchType).toBe('derived')
    expect(hit?.analysis?.steps.map((s) => s.form)).toEqual(['an'])
    expect(hit?.score).toBeCloseTo(0.45, 9)
  })
})
