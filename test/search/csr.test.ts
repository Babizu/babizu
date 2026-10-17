/**
 * 對應組檢索（實驗性；src/search/csr）：模型檢查、成本公式、去詞綴、搜尋與說明、經過搜尋引擎。
 * 模型與詞庫都是合成的，只用來驗證機制。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.ts'
import {
  buildCostTables,
  buildSearchIndex,
  CorrespondenceSearch,
  createAffixStripper,
  inventoryOf,
  SearchEngine,
  segmentEdits,
  validateCsrModel,
  type CsrModel,
} from '../../src/search/index.ts'
import type { LanguageProfile } from '../../packages/bcdp/src/index.ts'
import type { CorpusRecord, Unit } from '../../src/schema/types.ts'

/** A 方言的 r 在 B 方言常常脫落、有時變 l；詞尾的 s 在 B 寫成 ts */
const MODEL: CsrModel = {
  format: 'babizu-csr-model',
  version: 1,
  dialects: ['north', 'south'],
  segments: ['a', 'i', 'u', 'r', 'l', 't', 's', 'ts', 'k', 'w', 'm'],
  patterns: [
    { reflexes: { north: 'r', south: '-' }, sites: 6 },
    { reflexes: { north: 'r', south: 'l' }, sites: 3 },
    { reflexes: { north: 'r', south: 'r' }, sites: 1 },
    { reflexes: { north: 's', south: 'ts' }, sites: 4 },
    { reflexes: { north: 'a', south: 'a' }, sites: 20 },
    { reflexes: { north: 'u', south: 'u' }, sites: 20 },
    { reflexes: { north: 't', south: 't' }, sites: 10 },
    { reflexes: { north: 'k', south: 'k' }, sites: 10 },
    { reflexes: { north: 'w', south: 'w' }, sites: 5 },
    { reflexes: { north: 'm', south: 'm' }, sites: 5 },
    { reflexes: { north: 'x', south: 'y' }, sites: 1 },
  ],
}

const PROFILE: LanguageProfile = {
  format: 'babizu-language-profile',
  version: 1,
  rules: [
    { category: '詞尾', position: 'final', rules: [['l', 'n', 0.1]] },
    { category: '喉塞音', position: 'initial', rules: [["'", '', 0.1]] },
  ],
  morphology: {
    minStem: 3,
    prefixes: [{ form: 'mu' }, { form: 'ma' }],
    suffixes: [{ form: 'an' }],
    infixes: [{ form: 'in' }, { form: 'a' }],
    reduplication: [{ pattern: 'CV' }],
    alternations: [{ underlying: 't', surface: 'd', position: 'final' }, { underlying: 'a', surface: "a'", position: 'final', cost: 0 }],
  },
}

describe('模型檢查', () => {
  it('正確的模型沒有錯誤；方言要在站台的變體中', () => {
    expect(validateCsrModel(MODEL)).toEqual([])
    expect(validateCsrModel(MODEL, ['north', 'south', 'east'])).toEqual([])
    expect(validateCsrModel(MODEL, ['north'])).toEqual(['方言「south」不在站台的 varieties 中'])
  })

  it('格式、欄位、參數、等級的錯誤都列出來', () => {
    const errors = validateCsrModel({ ...MODEL, format: 'x', extra: 1, params: { lambda: -1, nope: 1 }, levels: { strict: { a: 1, b: 1 } }, sourceDialects: { dict: 'west' } })
    expect(errors).toEqual(
      expect.arrayContaining([
        'extra 是未知的欄位',
        'format 必須是 "babizu-csr-model"',
        'params.lambda 必須是非負的有限數',
        'params.nope 是未知的參數',
        'levels.strict 是未知的等級（只有 normal、loose）',
        'sourceDialects.dict「west」不在 dialects 中',
      ]),
    )
    expect(validateCsrModel(null)).toEqual(['模型必須是物件'])
  })
})

describe('成本表', () => {
  const inventory = inventoryOf(MODEL.segments)
  const F = inventory.F
  const id = (s: string) => inventory.id.get(s) as number
  const tables = buildCostTables({ dialects: MODEL.dialects, inventory, patterns: MODEL.patterns, rules: [], minSites: 2, beta: 1, priorSites: 0 })

  it('−log P(w | s)：r 在 A → B 的三種對應（β ＝ 1 加在兩邊相同上）；不到 minSites 的對應組不用', () => {
    const ab = tables[0 * 2 + 1]
    // r 這一列：∅ 6、l 3；r : r 只有 1 欄（不到 minSites）不用，兩邊相同只剩 β ＝ 1，分母 9 ＋ 1
    expect(ab[id('r') * F + 0]).toBeCloseTo(-Math.log(6 / 10))
    expect(ab[id('r') * F + id('l')]).toBeCloseTo(-Math.log(3 / 10))
    expect(ab[id('r') * F + id('r')]).toBeCloseTo(-Math.log(1 / 10))
    expect(ab[id('r') * F + id('t')]).toBe(Infinity)
    // 反方向：B 的 ∅ 對 A 的 r（B 少了一個段）
    expect(tables[1 * 2 + 0][0 * F + id('r')]).toBeCloseTo(0)
  })

  it('同一個方言的表只有兩邊相同', () => {
    const aa = tables[0]
    expect(aa[id('r') * F + id('r')]).toBe(0)
    expect(aa[id('r') * F + id('l')]).toBe(Infinity)
  })

  it('手寫規則當先驗：段層級的編輯兩個方向各加 priorSites 欄', () => {
    expect(segmentEdits(['a', 'r', 'u'], ['a', 'w'])).toEqual([['r', ''], ['u', 'w']])
    const withPrior = buildCostTables({ dialects: MODEL.dialects, inventory, patterns: MODEL.patterns, rules: [{ source: 'k', target: 'ts' }], minSites: 2, beta: 1, priorSites: 2 })
    // k 這一列：k 10（＋β）、ts 2（先驗）
    expect(withPrior[1][id('k') * F + id('ts')]).toBeCloseTo(-Math.log(2 / 13))
    expect(withPrior[1][id('ts') * F + id('k')]).toBeLessThan(Infinity)
  })
})

describe('去詞綴', () => {
  const strip = createAffixStripper(PROFILE, (s) => s.toLowerCase())
  const of = (w: string) => Object.fromEntries([...strip.analyses(w)].map(([stem, a]) => [stem, a.affixes.map((x) => `${x.type}:${x.form}`).join(' ')]))

  it('前綴、後綴、兩者都剝；詞幹至少 minStem 個字元', () => {
    expect(of('mutukuan')).toMatchObject({ mutukuan: '', tukuan: 'prefix:mu', mutuku: 'suffix:an', tuku: 'prefix:mu suffix:an' })
    expect(of('mutuan')).not.toHaveProperty('tu')
  })

  it('構詞音變還原（kabad-an → kabat）、前綴末的構詞音變（ma ＋ \' → ma\'）、詞首增生的規則（\'an）', () => {
    expect(of('kabadan')).toHaveProperty('kabat', 'suffix:an')
    expect(of("ma'akux")).toHaveProperty('akux', 'prefix:ma')
    expect(of("kiput'an")).toHaveProperty('kiput', 'suffix:an')
  })

  it('兩個字元以上的中綴；一個字元的不用；CV 重疊', () => {
    expect(of('kinawas')).toHaveProperty('kawas', 'infix:in')
    expect(of('kawas')).not.toHaveProperty('kwas')
    expect(of('kikiliw')).toHaveProperty('kiliw', 'reduplication:ki')
  })
})

describe('搜尋', () => {
  const entries = [
    { key: 'turu', dialect: 'north' },
    { key: 'tuu', dialect: 'south' },
    { key: 'tulu', dialect: 'south' },
    { key: 'kawas', dialect: 'north' },
    { key: 'kawats', dialect: 'south' },
    { key: 'mutuu', dialect: 'south' },
    { key: 'tuuk', dialect: null },
  ]
  const csr = new CorrespondenceSearch({ model: MODEL, profile: PROFILE, entries })
  const keys = (hits: Array<{ entry: number }>) => hits.map((h) => entries[h.entry].key)

  it('查 turu：同一個詞（同方言，0 分）最前，再來是學到的對應 r → ∅、r → l', () => {
    const hits = csr.search('turu', { fuzziness: 'loose' })
    expect(keys(hits).slice(0, 3)).toEqual(['turu', 'tuu', 'tulu'])
    expect(hits[0].score).toBe(0)
    expect(hits[1]).toMatchObject({ queryDialect: 'north', entryDialect: 'south', queryAffixes: [], entryAffixes: [] })
  })

  it('剝詞綴付 λ：mutuu 經由剝 mu- 找到，排在不用剝的後面', () => {
    const hits = csr.search('turu', { fuzziness: 'loose' })
    const mutuu = hits.find((h) => entries[h.entry].key === 'mutuu')
    expect(mutuu).toMatchObject({ entryStem: 'tuu', entryAffixes: [{ type: 'prefix', form: 'mu' }] })
    expect(mutuu?.score).toBeGreaterThan(hits[1].score + csr.params.lambda - 1e-9)
  })

  it('方言未知的詞條也假設方言；詞尾 s → ts', () => {
    expect(keys(csr.search('kawas', { fuzziness: 'normal' }))).toContain('kawats')
    expect(keys(csr.search('turuk', { fuzziness: 'loose' }))).toContain('tuuk')
  })

  it('寬鬆程度：exact 只要相同的詞幹、沒有剝詞綴；門檻隨查詢長度放寬', () => {
    expect(keys(csr.search('turu', { fuzziness: 'exact' }))).toEqual(['turu'])
    expect(csr.maxScore('turu', 'normal')).toBeCloseTo(4 + 0.6 * 4)
    expect(csr.maxScore('turu', 'loose')).toBeCloseTo(5 + 0.8 * 4)
    for (const h of csr.search('turu', { fuzziness: 'normal' })) expect(h.score).toBeLessThanOrEqual(csr.maxScore('turu', 'normal'))
  })

  it('說明：每一步是哪一對音段；r → ∅ 是學到的對應', () => {
    const hit = csr.search('turu', { fuzziness: 'loose' }).find((h) => entries[h.entry].key === 'tuu')
    const steps = csr.explain(hit as NonNullable<typeof hit>)
    expect(steps.map((s) => `${s.source}>${s.target}:${s.kind}`)).toEqual(['t>t:match', 'u>u:match', 'r>:correspondence', 'u>u:match'])
    expect(steps.reduce((s, x) => s + x.cost, 0)).toBeCloseTo(hit?.score ?? NaN)
  })

  it('accept 篩掉的詞不回傳', () => {
    expect(keys(csr.search('turu', { fuzziness: 'loose', accept: (e) => entries[e].dialect !== 'north' }))).not.toContain('turu')
  })
})

describe('經過搜尋引擎：當作詞形比對的核心', () => {
  const rec = (localId: string, unit: Unit, text: string, zh: string, dialects: string[]): CorpusRecord =>
    createRecord({ source: 'dict', localId, unit, text, citation: createCitation(`dict ${localId}`) }, { senses: [createSense({ zh })], dialects })
  const records = [
    rec('turu', 'word', 'turu', '三', ['north']),
    rec('tuu', 'word', 'tuu', '三', ['south']),
    rec('tulu', 'word', 'tulu', '三', ['south']),
    rec('mutuu', 'word', 'mutuu', '第三', ['south']),
    rec('unmarked', 'word', 'tuuk', '某詞', []),
    rec('s1', 'sentence', 'turu ka sapi', '例句一', ['north']),
    rec('s2', 'sentence', 'tulu ka sapi', '例句二', ['south']),
  ]
  const built = buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: PROFILE, varieties: [{ code: 'north' }, { code: 'south' }] })
  const data = JSON.parse(JSON.stringify(built))
  const withModel = new SearchEngine({ ...data, csr: { ...MODEL, sourceDialects: { dict: 'south' } } })
  const without = new SearchEngine(data)
  const search = (q: string, options: Parameters<SearchEngine['search']>[1] = {}) => withModel.search(q, { fuzziness: 'loose', algorithm: 'csr', ...options })
  const entry = (res: ReturnType<SearchEngine['search']>, id: string) => res.entries.find((h) => h.doc.id === `dict:${id}`)

  it('對應組檢索的分析對到既有的命中方式：沒剝詞綴是模糊（同一個詞是完全相符）、剝詞庫詞的是自動派生', () => {
    const res = search('turu', { fields: ['native'] })
    expect(res.algorithm).toBe('csr')
    expect(entry(res, 'turu')).toMatchObject({ matchType: 'fuzzy', distance: 0 })
    expect(entry(res, 'tuu')).toMatchObject({ matchType: 'fuzzy' })
    expect(entry(res, 'mutuu')).toMatchObject({ matchType: 'derived' })
    expect(entry(res, 'mutuu')?.csr?.entryAffixes).toEqual([{ type: 'prefix', form: 'mu' }])
    // 剝查詢的詞綴是自動拆解
    expect(entry(search('mutulu', { fields: ['native'] }), 'tulu')).toMatchObject({ matchType: 'lemma' })
  })

  it('分數換算成 BCDP 的刻度；說明的每一步也是，加起來是分數', () => {
    const tuu = entry(search('turu', { fields: ['native'] }), 'tuu')
    const csr = withModel.correspondence?.search as CorrespondenceSearch
    const raw = csr.search('turu', { fuzziness: 'loose' }).find((h) => csr.entries[h.entry].key === 'tuu')
    expect(tuu?.distance).toBeCloseTo((raw?.score ?? NaN) * csr.params.scoreScale, 2)
    const steps = tuu?.csr?.steps ?? []
    expect(steps.some((s) => s.kind === 'correspondence' && s.source === 'r' && s.target === '')).toBe(true)
    expect(steps.reduce((s, x) => s + x.cost, 0)).toBeCloseTo(tuu?.distance ?? NaN, 2)
  })

  it('例句也由對應組檢索比對：查 turu 找到含南部 tulu 的句子（方言規則找不到）', () => {
    expect(search('turu').occurrences.map((o) => o.doc.id)).toEqual(expect.arrayContaining(['dict:s1', 'dict:s2']))
    const s2 = search('turu').occurrences.find((o) => o.doc.id === 'dict:s2')
    expect(s2?.matches[0]).toMatchObject({ term: 'tulu', matchType: 'fuzzy' })
    expect(s2?.matches[0].csr).toBeDefined()
    expect(without.search('turu', { fuzziness: 'normal' }).occurrences.map((o) => o.doc.id)).not.toContain('dict:s2')
  })

  it('搜尋方法的篩選與筆數照舊：排除自動派生就不列 mutuu', () => {
    const res = search('turu', { fields: ['native'] })
    expect(res.methods.derived).toBeGreaterThan(0)
    expect(res.methods.exact).toBeGreaterThan(0)
    expect(entry(search('turu', { fields: ['native'], exclude: ['derived'] }), 'mutuu')).toBeUndefined()
  })

  it('沒有方言標記的記錄依 sourceDialects 推定方言；篩選條件照常', () => {
    expect(entry(search('turuk', { fields: ['native'] }), 'unmarked')?.csr?.entryDialect).toBe('south')
    expect(search('turu', { fields: ['native'], filters: { dialects: ['south'] } }).entries.map((h) => h.doc.id)).not.toContain('dict:turu')
  })

  it('沒有模型、或整個查詢含空白時，那一部分照常用方言規則', () => {
    expect(without.search('turu', { algorithm: 'csr' }).algorithm).toBe('bcdp')
    expect(without.correspondence).toBeNull()
    const multi = search('turu sapi')
    expect(multi.algorithm).toBe('csr')
    expect(multi.entries.every((h) => !h.csr)).toBe(true)
  })
})
