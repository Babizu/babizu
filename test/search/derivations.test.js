/**
 * 自動派生圖（src/search/derivations.js）：建置時由 BCDP 求每個詞最好的詞根，查詢時由詞根往下找自動派生形。
 * 資料是合成的，仿照 sungut（橋）→ pusungut（造橋）→ pausunguday（將要造橋；只出現在例句中）。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createGroup, createRecord, createSense } from '../../src/schema/index.js'
import { buildDerivationGraph, buildSearchIndex, createDerivationAnalyzer, DerivationGraph, isVirtualRootShape, SearchEngine, virtualRootCost } from '../../src/search/index.js'
import { mergeEdges } from '../../src/search/derivations.js'
import { compareHits, compareOccurrences, mergeMorphMatch, replacesRecordHit } from '../../src/search/scoring.js'
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
    const root = derivations.edges[k + 1]
    const name = root < terms.length ? terms[root] : `*${derivations.virtual[root - terms.length]}`
    out.push(`${terms[word]} → ${name} ${derivations.analyses[derivations.edges[k + 2]][0]}`)
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
    // 兩個階段：詞庫中的詞根與虛擬詞根的候選（可切塊平行），再看全部的邊過濾候選
    const lexical = analyzer.analyze()
    const analyzed = mergeEdges(lexical, analyzer.virtual(lexical))
    // 平行建置的路徑（analyzeAll 一起算候選，第 2 階段只過濾）與單執行緒現算的結果相同
    const all = analyzer.analyzeAll()
    expect(all.edges).toEqual(lexical)
    expect(analyzer.virtual(all.edges, all.virtual)).toEqual(analyzer.virtual(lexical))
    expect(analyzed.length).toBe(edges.length)
    for (const { word, root, analysis } of analyzed) {
      // 詞庫中的詞根是詞編號，虛擬詞根是詞幹字串；都比詞短
      expect(Array.from(typeof root === 'string' ? root : terms[root]).length).toBeLessThan(Array.from(terms[word]).length)
      // 成本＝步驟成本＋音變說明的成本（說明與成本一致）
      const sum = analysis.steps.reduce((s, x) => s + x.cost, 0) + analysis.notes.reduce((s, x) => s + x.cost, 0)
      expect(sum).toBeCloseTo(analysis.cost, 9)
    }
    // 切塊計算與一次算完相同（網站建置平行計算時依詞編號接起來）
    const half = Math.floor(analyzer.count / 2)
    expect([...analyzer.analyze(0, half), ...analyzer.analyze(half)]).toEqual(lexical)
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

describe('虛擬詞根與自動同根：共同的詞根不在詞庫中（查 binubuer 找到 mabubuer）', () => {
  const MORPH = {
    cost: 0.2,
    minStem: 3,
    prefixes: [{ form: 'ma' }, { form: 'ka' }],
    infixes: [{ form: 'in' }],
    suffixes: [{ form: 'an' }],
    reduplication: [{ pattern: 'CV' }],
    alternations: [{ underlying: 't', surface: 'd', position: 'final', cost: 0.05 }],
  }
  const list = [
    rec('mabubuer', 'word', 'mabubuer'), // ma- ＋ bubuer（bubuer 不在詞庫中）
    rec('s1', 'sentence', 'mabubuer lia'),
    rec('karaw', 'word', 'karaw'), // ka- ＋ raw：只有一個元音，形狀不像詞根，不建虛擬詞根
    rec('baket', 'word', 'baket'),
    rec('mabaketan', 'word', 'mabaketan'), // 詞庫中有 baket，不必另建虛擬詞根
    rec('dakut', 'word', 'dakut'),
    rec('dakudan', 'word', 'dakudan'), // dakut ＋ -an（t → d，0.25）；虛擬的 dakud ＋ -an 是 0.2 ＋ 0.03 × 5，比詞庫的貴
  ]
  const data = JSON.parse(JSON.stringify(buildSearchIndex({ items: list.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: MORPH } })))
  const graph = buildDerivationGraph(data)
  const v = new SearchEngine({ ...data, derivations: graph })

  it('只在詞庫解釋不了時建立、形狀要像詞根；詞庫外的詞根越長越貴：bubuer 有，raw（一個音節）與 baketan、mabaket、dakud 沒有', () => {
    expect(graph.virtual).toContain('bubuer')
    expect(graph.virtual).not.toContain('raw')
    // mabaketan：詞庫的 baket（ma- ＋ -an，0.4）比 baketan、mabaket（一個詞綴 0.2 ＋ 0.03 × 7 ＝ 0.41）便宜
    // dakudan：dakud ＋ -an 是 0.2 ＋ 0.03 × 5 ＝ 0.35，比詞庫的 dakut ＋ -an（t → d，0.25）貴
    expect(graph.virtual).toEqual(['bubuer'])
    expect(virtualRootCost('bubuer', v.virtualRootSearch?.spec ?? { virtualRootLengthCost: 0 })).toBeCloseTo(0.18, 9)
    expect(isVirtualRootShape('bubuer', { minStem: 3, vowels: 'aeiou' })).toBe(true)
    expect(isVirtualRootShape('raw', { minStem: 3, vowels: 'aeiou' })).toBe(false)
  })

  it('查 binubuer（詞庫中沒有）：拆出 bubuer（<in>），找到同根的 mabubuer，標為自動同根', () => {
    const res = v.search('binubuer', { fields: ['native'] })
    const hit = res.entries.find((h) => h.doc.id === 'dict:mabubuer')
    expect(hit?.matchType).toBe('sibling')
    expect(hit?.analysis).toMatchObject({ stem: 'bubuer', sibling: { root: 'bubuer', cost: 0.2, penalty: 0.18, lexical: false } })
    expect(hit?.analysis?.sibling?.steps.map((st) => `${st.type}:${st.form}`)).toEqual(['infix:in'])
    expect(hit?.analysis?.steps.map((st) => st.form)).toEqual(['ma'])
    // 0.4 ＋ 拆解 0.2 ＋ 詞庫外的詞根 0.03 × 6 ＋ 往下 0.2
    expect(hit?.score).toBeCloseTo(0.98, 9)
    // 例句也找得到
    expect(res.occurrences.find((o) => o.doc.id === 'dict:s1')?.matches[0]).toMatchObject({ matchType: 'sibling', token: 'mabubuer' })
  })

  it('查詢本身就是那個詞時不算自己；沒有虛擬詞根的圖（舊版）沒有自動同根', () => {
    expect(v.search('mabubuer', { fields: ['native'] }).entries.some((h) => h.matchType === 'sibling')).toBe(false)
    const plain = new SearchEngine({ ...data, derivations: { ...graph, virtual: [], edges: graph.edges.filter((_, k) => k % 3 !== 1 || graph.edges[k] < data.lexicon.count) } })
    expect(plain.search('binubuer', { fields: ['native'] }).entries).toEqual([])
  })

  it('自動同根不取代其他命中：同一個詞已有自動派生時保留原本的', () => {
    const m = { term: 'x', distance: 0.3, matchType: /** @type {const} */ ('sibling') }
    const prev = { term: 'x', distance: 0.6, matchType: /** @type {const} */ ('derived') }
    expect(mergeMorphMatch(m, prev, 'q')).toMatchObject({ matchType: 'derived', distance: 0.6 })
    expect(replacesRecordHit({ matchType: 'sibling', score: 0.1 }, { matchType: 'lemma', score: 0.9 }, (a, b) => a.score - b.score)).toBe(false)
    expect(replacesRecordHit({ matchType: 'lemma', score: 0.9 }, { matchType: 'sibling', score: 0.1 }, (a, b) => a.score - b.score)).toBe(true)
  })
})

describe('虛擬詞根的對稱：建置與查詢用同一個函式、同樣的條件', () => {
  const MORPH = { cost: 0.1, minStem: 3, prefixes: [{ form: 'ma' }, { form: 'mu' }, { form: 'sa' }, { form: 'masa' }] }
  const list = [rec('samian', 'word', 'samian'), rec('masamian', 'word', 'masamian'), rec('musamian', 'word', 'musamian'), rec('kamian', 'word', 'mumian')]
  const data = JSON.parse(JSON.stringify(buildSearchIndex({ items: list.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: MORPH } })))
  const graph = buildDerivationGraph(data)
  const s = new SearchEngine({ ...data, derivations: graph })

  /** 詞 → 它的虛擬詞根 @param {string} w */
  const virtualOf = (w) => {
    const terms = s.index.terms
    const out = []
    for (let k = 0, word = 0; k < graph.edges.length; k += 3) {
      word += graph.edges[k]
      const root = graph.edges[k + 1]
      if (terms[word] === w && root >= terms.length) out.push(graph.virtual[root - terms.length])
    }
    return out
  }

  it('samian 是 masamian、musamian 的詞根，本身就是根：不再拆成 sa- ＋ 虛擬詞根 mian；mumian 不是根，照樣拆出 mian', () => {
    expect(virtualOf('samian')).toEqual([])
    expect(virtualOf('mumian')).toEqual(['mian'])
    // 查詢端同樣的條件：查 samian 不往上拆，找不到 mumian
    expect(s.search('samian', { fields: ['native'] }).entries.some((h) => h.matchType === 'sibling')).toBe(false)
  })

  it('查 masamian：自動拆解已有 ma- ＋ samian，不再拆成 masa- ＋ mian 去找同根詞（mumian）', () => {
    const res = s.search('masamian', { fields: ['native'] })
    expect(res.entries.find((h) => h.doc.id === 'dict:samian')?.matchType).toBe('lemma')
    expect(res.entries.some((h) => h.doc.id === 'dict:kamian')).toBe(false)
    expect(res.entries.filter((h) => h.matchType === 'sibling').every((h) => h.analysis?.sibling?.lexical)).toBe(true)
  })
})

describe('自動同根：詞根在詞庫中（查詢自動拆解出的詞根往下走）', () => {
  const MORPH = { cost: 0.1, minStem: 3, prefixes: [{ form: 'ma' }, { form: 'mu' }, { form: 'sa' }], suffixes: [{ form: 'an' }] }
  const list = [
    rec('samian', 'word', 'samian'),
    rec('masamian', 'word', 'masamian'),
    rec('musamian', 'word', 'musamian'),
    rec('s1', 'sentence', 'musamian lia'),
    // musamian ＋ -an：samian 的孫輩，不是同根（同根只取詞根的直接子詞）
    rec('musamianan', 'word', 'musamianan'),
    // kitiku 的子詞；查詢 makétéko 要三個方言音變（0.3）才拆到 kitiku，不往上找同根
    rec('kitiku', 'word', 'kitiku'),
    rec('makitiku', 'word', 'makitiku'),
    rec('mukitiku', 'word', 'mukitiku'),
  ]
  const data = JSON.parse(JSON.stringify(buildSearchIndex({ items: list.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: MORPH } })))
  const s = new SearchEngine({ ...data, derivations: buildDerivationGraph(data) })

  it('查 masamian：自動拆解出詞庫中的 samian，往下找到 musamian（自動同根，詞根在詞庫中，沒有詞庫外的代價）', () => {
    const res = s.search('masamian', { fields: ['native'] })
    const hit = res.entries.find((h) => h.doc.id === 'dict:musamian')
    expect(hit?.matchType).toBe('sibling')
    expect(hit?.analysis).toMatchObject({ stem: 'samian', sibling: { root: 'samian', cost: 0.1, penalty: 0, lexical: true } })
    expect(hit?.analysis?.sibling?.steps.map((st) => `${st.type}:${st.form}`)).toEqual(['prefix:ma'])
    // 0.4 ＋ 拆解 0.1 ＋ 往下 0.1
    expect(hit?.score).toBeCloseTo(0.6, 9)
    expect(res.occurrences.find((o) => o.doc.id === 'dict:s1')?.matches[0]).toMatchObject({ matchType: 'sibling', token: 'musamian' })
    // 查詢本身不算；孫輩 musamianan 不是同根
    expect(res.entries.some((h) => h.doc.id === 'dict:masamian' && h.matchType === 'sibling')).toBe(false)
    expect(res.entries.some((h) => h.doc.id === 'dict:musamianan')).toBe(false)
  })

  it('兩條邊都要是可靠的拆法：查詢拆到詞根的音變超過 SIBLING_MAX_SOUND 時不往上', () => {
    const near = s.search('makétiku', { fields: ['native'] })
    expect(near.entries.find((h) => h.doc.id === 'dict:kitiku')?.matchType).toBe('lemma')
    expect(near.entries.find((h) => h.doc.id === 'dict:mukitiku')?.matchType).toBe('sibling')
    const far = s.search('makétéko', { fields: ['native'] })
    expect(far.entries.find((h) => h.doc.id === 'dict:kitiku')?.matchType).toBe('lemma')
    expect(far.entries.some((h) => h.doc.id === 'dict:mukitiku' && h.matchType === 'sibling')).toBe(false)
  })

  it('排序：自動同根在原本的命中之後，即使分數比較好', () => {
    const doc = { role: 'head', text: 'x', index: 0 }
    const sibling = { score: 0.2, matchType: /** @type {const} */ ('sibling'), term: 'x', kind: /** @type {const} */ ('head'), doc, distance: 0.2 }
    const weak = { score: 0.9, matchType: /** @type {const} */ ('substring'), term: 'x', kind: /** @type {const} */ ('head'), doc, distance: 0.9 }
    expect(compareHits(weak, sibling)).toBeLessThan(0)
    expect(compareOccurrences(weak, sibling)).toBeLessThan(0)
  })

  it('自動同根排在原本的命中之後，不佔上限：limit 只算原本的命中，同根詞另外全列', () => {
    const res = s.search('masamian', { fields: ['native'], limit: 1 })
    const own = res.entries.filter((h) => h.matchType !== 'sibling')
    expect(own.length).toBe(1)
    expect(res.entries.at(-1)?.matchType).toBe('sibling')
    // 排序：所有原本的命中都在自動同根之前
    const tiers = res.entries.map((h) => (h.matchType === 'sibling' ? 1 : 0))
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b))
    expect(res.entryGroups.at(-1)?.best.matchType).toBe('sibling')
  })

  it('同根只取詞根的直接子詞，兩條邊的音變都不超過 SIBLING_MAX_SOUND', () => {
    // 合成的圖：r（詞 0）→ a（0.1）、b（0.3，其中音變 0.25）、a → c（孫輩）
    const g = new DerivationGraph(
      {
        version: 2,
        count: 4,
        virtual: [],
        steps: [{ type: 'prefix', form: 'x', gloss: null, cost: 0.05 }],
        analyses: [
          [0.1, [0], []],
          [0.3, [0], []],
        ],
        edges: [1, 0, 0, 1, 0, 1, 1, 1, 0],
      },
      ['r', 'a', 'b', 'c'],
    )
    const seeds = [{ id: 0, distance: 0.1 }]
    expect(g.childrenOf(seeds, { maxPath: 1, maxSound: 0.2 }).map((x) => x.word)).toEqual([1])
    expect(g.childrenOf(seeds, { maxPath: 1, maxSound: 0.3 }).map((x) => x.word)).toEqual([1, 2])
    // 路徑上限含起點的距離
    expect(g.childrenOf(seeds, { maxPath: 0.15, maxSound: 1 })).toEqual([])
    // 子樹（descendants）才會走到孫輩 c
    expect(g.descendants(seeds, 1).map((x) => x.word)).toContain(3)
  })

  it('查詢本身是別的詞的詞根時不往上（samian 是 masamian、musamian 的詞根）；詞庫外的查詢也找得到', () => {
    expect(s.search('samian', { fields: ['native'] }).entries.some((h) => h.matchType === 'sibling')).toBe(false)
    // sasamian 不在詞庫中：自動拆解得到 samian（sa-），再往下找到兩個同根詞
    const res = s.search('sasamian', { fields: ['native'] })
    expect(res.entries.find((h) => h.doc.id === 'dict:samian')?.matchType).toBe('lemma')
    const siblings = res.entries.filter((h) => h.matchType === 'sibling').map((h) => h.doc.id)
    expect(siblings.sort()).toEqual(['dict:masamian', 'dict:musamian'])
  })
})

describe('虛擬詞根的三個原則：字面、詞綴精確、詞庫外的詞根越長越貴', () => {
  /** @param {any} morph @param {string[]} words */
  const graphOf = (morph, words) => {
    const data = JSON.parse(JSON.stringify(buildSearchIndex({ items: words.map((w) => ({ record: rec(w, 'word', w), shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: morph } })))
    const graph = buildDerivationGraph(data)
    const engine = new SearchEngine({ ...data, derivations: graph })
    /** @param {string} w */
    const virtualOf = (w) => {
      const terms = engine.index.terms
      const out = []
      for (let k = 0, word = 0; k < graph.edges.length; k += 3) {
        word += graph.edges[k]
        if (terms[word] === w && graph.edges[k + 1] >= terms.length) out.push(graph.virtual[graph.edges[k + 1] - terms.length])
      }
      return out
    }
    return { graph, engine, virtualOf }
  }

  it('長的詞庫外詞根輸給詞庫的拆法：pinahazaban ＝ pina-hazap-an，不另建 pinahazab（9 個字元，0.1 ＋ 0.27）', () => {
    // pina- 是 p‹in›a-（構詞文法展開後是一個前綴）
    const { virtualOf } = graphOf(
      { cost: 0.1, minStem: 3, prefixes: [{ form: 'pina' }, { form: 'pa' }], infixes: [{ form: 'in' }], suffixes: [{ form: 'an' }], alternations: [{ underlying: 'p', surface: 'b', cost: 0.05 }] },
      ['hazap', 'pinahazaban'],
    )
    // 詞庫的拆法 0.25（兩個步驟 ＋ 交界濁化）；固定懲罰 0.1 的舊版會建 pinahazab（0.1 ＋ 0.1 ＜ 0.25）。
    // 原樣的 hazab（pina- ＋ -an）也是 0.2 ＋ 0.15，比詞庫的貴
    expect(virtualOf('pinahazaban')).toEqual([])
  })

  it('分數相同的拆法取剝得最乾淨的：mabubuer 只建 bubuer（ma-），不建 abubuer（m-）', () => {
    const { virtualOf } = graphOf({ cost: 0.1, minStem: 3, prefixes: [{ form: 'ma' }, { form: 'm' }] }, ['mabubuer'])
    expect(virtualOf('mabubuer')).toEqual(['bubuer'])
  })

  it('詞綴必須原樣出現：mobubuer（mu- 的方言寫法 mo-）不拆出 bubuer', () => {
    const { virtualOf } = graphOf({ cost: 0.1, minStem: 3, prefixes: [{ form: 'mu' }] }, ['mububuer', 'mobubuer'])
    expect(virtualOf('mububuer')).toEqual(['bubuer'])
    expect(virtualOf('mobubuer')).toEqual([])
  })

  it('詞根是詞中原樣的一段：abuk 不會靠閃音規則（ara ↔ a）發明出 rabuk', () => {
    const { graph } = graphOf({ cost: 0.1, minStem: 3, prefixes: [{ form: 'a' }] }, ['abuk', 'arabuk'])
    expect(graph.virtual).not.toContain('rabuk')
  })

  it('構詞音變在詞幹與後綴的交界還原：kabadan 的詞根是 kabat（kabad ＋ t → d 只差 0.05，取原樣的 kabad 較便宜）', () => {
    const { graph } = graphOf({ cost: 0.1, minStem: 3, suffixes: [{ form: 'an' }], alternations: [{ underlying: 't', surface: 'd', cost: 0.05 }] }, ['kabadan', 'kabadi'])
    // 兩個都是原樣的 kabad（成本較低）；kabat 要多 0.05
    expect(graph.virtual).toEqual(['kabad'])
  })
})

describe('搜尋方法：個別排除，並回報每種方法找得到幾筆', () => {
  const p = engineOf([rec('sungut', 'word', 'sungut'), rec('sungutan', 'word', 'sungutan'), rec('s1', 'sentence', 'sungutan lia')], { cost: 0.3, minStem: 3, suffixes: [{ form: 'an' }] })

  it('不看自動派生時，sungutan 改以原本的開頭相符出現（不會連它也消失）', () => {
    const all = p.search('sungut', { fields: ['native'] })
    expect(all.entries.find((h) => h.doc.id === 'dict:sungutan')?.matchType).toBe('derived')
    expect(all.methods).toMatchObject({ exact: 1, derived: 2, prefix: 2 })
    const noDerived = p.search('sungut', { fields: ['native'], exclude: ['derived'] })
    expect(noDerived.entries.find((h) => h.doc.id === 'dict:sungutan')?.matchType).toBe('prefix')
    expect(noDerived.occurrences.find((o) => o.doc.id === 'dict:s1')?.matchType).toBe('prefix')
    // 數量不受排除影響（介面用來顯示每個方法有幾筆）
    expect(noDerived.methods).toEqual(all.methods)
    // 每一組是組內各方法的聯集：sungutan 與例句同時是開頭相符與自動派生，各組各算一次
    expect(all.methodGroups).toEqual({ spelling: 1, partial: 2, dictionary: 0, automatic: 2 })
    expect(noDerived.methodGroups).toEqual(all.methodGroups)
  })

  it('一組的筆數是聯集：同一句同時以開頭與結尾相符命中，部分符合只算一筆', () => {
    const q = engineOf([rec('sungut', 'word', 'sungut'), rec('s2', 'sentence', 'kasungut lia sunguttu')], { cost: 0.3, minStem: 3, suffixes: [{ form: 'an' }] })
    const res = q.search('sungut', { fields: ['native'] })
    expect(res.methods).toMatchObject({ prefix: 1, suffix: 1 })
    expect(res.methodGroups.partial).toBe(1)
  })

  it('兩者都排除時就不出現', () => {
    const none = p.search('sungut', { fields: ['native'], exclude: ['derived', 'prefix'] })
    expect(none.entries.map((h) => h.doc.id)).toEqual(['dict:sungut'])
    expect(none.occurrences).toEqual([])
  })
})

describe('辭典的構詞關係：詞綴的條目不算同根；家族的排序仍以直接的命中為證據', () => {
  /** @param {string} localId @param {string} text @param {{group: string, role?: string, parent?: string, unit?: string}} o */
  const rg = (localId, text, o) =>
    createRecord(
      { source: 'dict', localId, unit: /** @type {any} */ (o.unit ?? 'word'), text, citation: createCitation(`dict ${localId}`) },
      { senses: [createSense({ zh: text })], group: { id: `dict:${o.group}`, role: /** @type {any} */ (o.role ?? 'head'), parent: o.parent ? `dict:${o.parent}` : null, seq: 0 } },
    )
  const groups = [
    createGroup({ source: 'dict', localId: 'in', type: 'entry', title: '<in>' }),
    createGroup({ source: 'dict', localId: 'kawas', type: 'entry', title: 'kawas-' }),
  ]
  const list = [
    // <in> 是中綴的條目：底下的詞是帶這個中綴的例子
    rg('in', '<in>', { group: 'in', unit: 'affix' }),
    rg('in-1', 'kinawas', { group: 'in', role: 'form' }),
    rg('in-2', 'binaket', { group: 'in', role: 'form' }),
    // kawas- 是詞根的條目
    rg('kawas', 'kawas-', { group: 'kawas', unit: 'affix' }),
    rg('kawas-1', 'mukawas', { group: 'kawas', role: 'form' }),
    rg('kawas-2', 'kinawas', { group: 'kawas', role: 'form', parent: 'kawas-1' }),
    rg('kawas-3', 'pakawas', { group: 'kawas', role: 'form' }),
  ]
  const data = JSON.parse(JSON.stringify(buildSearchIndex({ items: list.map((record) => ({ record, shard: 'all' })), groups, sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: { cost: 0.2, minStem: 3, prefixes: [{ form: 'mu' }, { form: 'pa' }], infixes: [{ form: 'in' }] } } })))
  const g = new SearchEngine({ ...data, derivations: buildDerivationGraph(data) })
  const res = g.search('kinawas', { fields: ['native'] })
  const kindOf = (/** @type {string} */ id) => res.entries.find((h) => h.doc.id === id)?.kind

  it('<in> 是 kinawas 的確定拆解（上層），但它底下的 binaket 不是 kinawas 的同根；kawas- 條下的 pakawas 是', () => {
    expect(kindOf('dict:in')).toBe('parent')
    expect(kindOf('dict:in-2')).toBeUndefined()
    expect(kindOf('dict:kawas-3')).toBe('sibling')
  })

  it('kawas- 同時是自動拆解與確定拆解：以確定拆解呈現，但仍算直接的命中（家族排序的證據）', () => {
    const root = res.entries.find((h) => h.doc.id === 'dict:kawas')
    expect(root).toMatchObject({ kind: 'parent', direct: true })
    expect(res.entryGroups[0].root.doc.id).toBe('dict:kawas')
  })
})
