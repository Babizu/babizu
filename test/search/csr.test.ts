/**
 * 對應組檢索（實驗性；src/search/csr）：模型檢查、成本公式、前後文單位、學習、去詞綴、搜尋與說明、經過搜尋引擎。
 * 模型與詞庫都是合成的，只用來驗證機制。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.ts'
import {
  buildContextTables,
  buildCostTables,
  buildSearchIndex,
  contextMatches,
  CorrespondenceSearch,
  createAffixStripper,
  createAligner,
  inventoryOf,
  learnCorrespondences,
  SearchEngine,
  sukhotinVowels,
  validateCsrModel,
  type CsrAlignedPair,
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

/** 加上兩個前後文單位：北部的 ura 對到南部的 owa、詞尾的 l 對到 n（ki → ke 只有 1 次，不用） */
const CONTEXT_MODEL: CsrModel = {
  ...MODEL,
  patterns: [
    ...MODEL.patterns,
    { reflexes: { north: 'ura', south: 'owa' }, sites: 3 },
    { reflexes: { north: 'l', south: 'n' }, sites: 4, position: 'final' },
    { reflexes: { north: 'ki', south: 'ke' }, sites: 1 },
  ],
  occurrences: { north: { ura: 4, 'l$': 5, ki: 9 }, south: { owa: 3, 'n$': 6, ke: 2 } },
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

  it('前後文單位：position 只能是 initial、final；每一邊都要有出現次數；手寫規則的先驗（priorSites）已經沒有了', () => {
    expect(validateCsrModel(CONTEXT_MODEL)).toEqual([])
    const missing = validateCsrModel({ ...CONTEXT_MODEL, occurrences: { north: { ura: 4 } } })
    expect(missing).toEqual(expect.arrayContaining(['patterns[11] 是前後文單位，occurrences.south 要有「owa」的出現次數（或在 of 中給分母）', 'patterns[12] 是前後文單位，occurrences.north 要有「l$」的出現次數（或在 of 中給分母）']))
    expect(validateCsrModel({ ...MODEL, patterns: [{ reflexes: { north: 'l', south: 'n' }, sites: 3, position: 'end' }] })).toEqual(['patterns[0].position 只能是 initial 或 final'])
    expect(validateCsrModel({ ...MODEL, params: { priorSites: 2 } })).toEqual(['params.priorSites 是未知的參數'])
  })
})

describe('成本表', () => {
  const inventory = inventoryOf(MODEL.segments)
  const F = inventory.F
  const id = (s: string) => inventory.id.get(s) as number
  const tables = buildCostTables({ dialects: MODEL.dialects, inventory, patterns: MODEL.patterns, minSites: 2, beta: 1 })

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

  it('前後文單位不進單一音段的表', () => {
    const t = buildCostTables({ dialects: MODEL.dialects, inventory, patterns: CONTEXT_MODEL.patterns, minSites: 2, beta: 1 })
    expect(t[1]).toEqual(tables[1])
  })
})

describe('前後文單位', () => {
  const dialects = CONTEXT_MODEL.dialects
  const inventory = inventoryOf([...CONTEXT_MODEL.segments, 'o', 'n', 'b', 'e'])
  const tables = buildCostTables({ dialects, inventory, patterns: CONTEXT_MODEL.patterns, minSites: 2, beta: 1 })
  const context = buildContextTables({ dialects, segments: new Set(inventory.forms), patterns: CONTEXT_MODEL.patterns, occurrences: CONTEXT_MODEL.occurrences, minSites: 2, normalize: (s) => s })
  const aligner = createAligner(inventory)
  const side = (s: string) => ({ lattice: inventory.tokenize(s), chars: Array.from(s) })
  /** 北 → 南的距離；withContext false 時不用前後文單位 */
  const dist = (q: string, e: string, withContext = true) => aligner.distance(side(q), side(e), tables[1], 4, Infinity, withContext ? contextMatches(Array.from(q), context[1]) : null)

  it('成本 −log(次數 ／ 來源字串的出現次數)，兩個方向各用自己的分母；不到 minSites 的不用', () => {
    expect(context[1].byFirst.get('u')?.find((u) => u.source === 'ura')?.cost).toBeCloseTo(-Math.log(3 / 4))
    expect(context[2].byFirst.get('o')?.find((u) => u.source === 'owa')?.cost).toBeCloseTo(0)
    expect(context[1].byFirst.get('l')?.find((u) => u.source === 'l')).toMatchObject({ target: 'n', position: 'final' })
    expect(context[1].size).toBe(2) // ki → ke 只有 1 次
    expect(context[0].size + context[3].size).toBe(0) // 同一個方言沒有前後文單位
  })

  it('兩邊都符合前後文時才便宜：kurak → kowak 用 ura → owa；kirak → kiwak（r 前不是 u）、kurak → kuwak（u 沒變）照舊', () => {
    expect(dist('kurak', 'kowak')).toBeLessThan(dist('kurak', 'kowak', false) - 4)
    expect(dist('kirak', 'kiwak')).toBe(dist('kirak', 'kiwak', false))
    expect(dist('kurak', 'kuwak')).toBe(dist('kurak', 'kuwak', false))
  })

  it('有位置的單位只在詞尾：bintul → bintun 便宜，lima → nima 照舊', () => {
    expect(dist('bintul', 'bintun')).toBeLessThan(dist('bintul', 'bintun', false))
    expect(dist('lima', 'nima')).toBe(dist('lima', 'nima', false))
  })

  it('說明：前後文單位是一步（kind context，附位置）', () => {
    const steps = aligner.align('kurak', 'kowak', tables[1], 4, context[1])
    expect(steps.map((x) => `${x.source}>${x.target}:${x.kind}`)).toEqual(['k>k:match', 'ura>owa:context', 'k>k:match'])
    expect(aligner.align('bintul', 'bintun', tables[1], 4, context[1]).at(-1)).toMatchObject({ source: 'l', target: 'n', kind: 'context', position: 'final' })
  })

  it('CorrespondenceSearch.explain 為前後文單位附「拆開來看」：逐音段比對的各步，合計比整段貴', () => {
    const csr = new CorrespondenceSearch({ model: CONTEXT_MODEL, profile: PROFILE, entries: [{ key: 'kowak', dialect: 'south' }] })
    const step = csr.explain({ queryStem: 'kurak', entryStem: 'kowak', queryDialect: 'north', entryDialect: 'south' }).find((x) => x.kind === 'context')
    expect(step?.parts?.length).toBeGreaterThan(0)
    expect(step?.parts?.every((p) => p.kind !== 'match')).toBe(true)
    expect((step?.parts ?? []).reduce((n, p) => n + p.cost, 0)).toBeGreaterThan(step?.cost ?? Infinity)
  })
})

describe('學習（只用資料）', () => {
  /** 'm a t u r a y' 與 'm a t o w a y'：同樣多的音段，- 是缺口 */
  const pair = (a: string, b: string): CsrAlignedPair => {
    const x = a.split(' '), y = b.split(' ')
    return { forms: [x.filter((t) => t !== '-').join(''), y.filter((t) => t !== '-').join('')], cols: x.map((t, k) => [t, y[k]] as [string, string]) }
  }
  // 北部的 r 在 u 之後對到南部的 w（u 也變 o）；其他地方的 r 保留、脫落或變 l；詞尾的 l 在南部是 n
  const PAIRS = [
    pair('m a t u r a y', 'm a t o w a y'),
    pair('k u r a n', 'k o w a n'),
    pair('b u r a s', 'b o w a s'),
    pair('t u r a k', 't o w a k'),
    pair('p i r a t', 'p i w a t'), // 單獨一個詞：i 之後的 r : w
    pair('a r i k', 'a r i k'),
    pair('s i r a m', 's i r a m'),
    pair('k a r i', 'k a - i'),
    pair('s a r u', 's a - u'),
    pair('t u r i', 't u l i'),
    pair('k u m u', 'k u m u'),
    pair('s u l a t', 's u l a t'),
    pair('b i n t u l', 'b i n t u n'),
    pair('k a w a l', 'k a w a n'),
    pair('s a p e l', 's a p e n'),
    pair('l i m a', 'l i m a'),
    pair('p i l a', 'p i l a'),
  ]
  const L = learnCorrespondences(['north', 'south'], PAIRS, { penalty: 2 })
  const find = (n: string, s: string, position?: string) => L.patterns.find((p) => p.reflexes.north === n && p.reflexes.south === s && p.position === position)

  it('r : w 在 u 之後的四個詞歸給前後文單位，剩下的 r : w 只有一欄（不到 minSites，不再是不看前後文的對應）', () => {
    const unit = L.units.find((u) => u.reflexes.north.includes('ur') && u.reflexes.south.includes('ow'))
    expect(unit).toBeDefined()
    expect(unit?.sites).toBe(4)
    expect(find('r', 'w')?.sites).toBe(1)
    expect(find('u', 'o')).toBeUndefined()
  })

  it('詞尾的 l → n 學成有位置的單位；出現次數記在 occurrences', () => {
    expect(find('l', 'n', 'final')).toMatchObject({ sites: 3 })
    expect(L.occurrences.north['l$']).toBe(3)
    expect(L.occurrences.south['n$']).toBe(4) // kowan 也是 n 結尾
  })

  it('一個詞造不出單位：兩個北部的詞對到同一個南部的詞時支持度只有 1', () => {
    const one = learnCorrespondences(['north', 'south'], [pair('m a t u r a y', 'm a t o w a y'), pair('p a t u r a y', 'm a t o w a y'), ...PAIRS.slice(5)], { penalty: 2 })
    expect(one.units.some((u) => u.reflexes.south.includes('ow'))).toBe(false)
    expect(one.patterns.find((p) => p.reflexes.north === 'r' && p.reflexes.south === 'w')?.sites).toBe(2)
  })

  it('元音類合併（poolVowels）：ura、ara 各只有一個詞對到 owa，合起來兩個詞才成為家族 ?ra → owa；元音由 Sukhotin 演算法從分布分出', () => {
    const pooled = [pair('m a t u r a y', 'm a t o w a y'), pair('r u h a r a t', 'r o h o w a t'), ...PAIRS.slice(5)]
    expect(learnCorrespondences(['north', 'south'], pooled, { penalty: 2 }).units.some((u) => u.reflexes.south === 'owa')).toBe(false)
    const P = learnCorrespondences(['north', 'south'], pooled, { penalty: 2, poolVowels: true })
    expect(P.vowels).toEqual(['a', 'e', 'i', 'o', 'u'])
    expect(P.units[0]).toMatchObject({ reflexes: { north: '?ra', south: 'owa' }, sites: 2, support: 2 })
    // 家族的每個成員各寫一條，sites 與分母（of）是整個家族的；r : w 全部被解釋掉
    expect(P.patterns.filter((p) => p.of).map((p) => p.reflexes.north).sort()).toEqual(['ara', 'ura'])
    expect(P.patterns.find((p) => p.reflexes.north === 'r' && p.reflexes.south === 'w')).toBeUndefined()
    expect(sukhotinVowels([['p', 'a', 't', 'a'], ['k', 'i', 't', 'u'], ['s', 'e', 'n', 'a']])).toEqual(new Set(['a', 'e', 'i', 'u']))
  })

  it('學到的模型通過檢查，搜尋時 maturay → matoway 用學到的前後文單位', () => {
    const model: CsrModel = { format: 'babizu-csr-model', version: 1, dialects: ['north', 'south'], segments: ['a', 'b', 'e', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'w', 'y'], patterns: L.patterns, occurrences: L.occurrences }
    expect(validateCsrModel(model)).toEqual([])
    const csr = new CorrespondenceSearch({ model, profile: PROFILE, entries: [{ key: 'matoway', dialect: 'south' }] })
    const hit = csr.search('maturay', { fuzziness: 'loose' })[0]
    expect(csr.explain(hit).filter((x) => x.kind !== 'match').map((x) => x.kind)).toEqual(['context'])
  })
})

describe('去詞綴', () => {
  const strip = createAffixStripper(PROFILE, (s) => s.toLowerCase())
  const of = (w: string) => Object.fromEntries([...strip.analyses(w)].map(([stem, a]) => [stem, a.affixes.map((x) => `${x.type}:${x.form}`).join(' ')]))

  it('前綴、後綴、兩者都剝；詞幹至少 minStem 個字元', () => {
    expect(of('mutukuan')).toMatchObject({ mutukuan: '', tukuan: 'prefix:mu', mutuku: 'suffix:an', tuku: 'prefix:mu suffix:an' })
    expect(of('mutuan')).not.toHaveProperty('tu')
  })

  it('構詞音變還原（kabad-an → kabat）、前綴末的構詞音變（ma ＋ \' → ma\'）；方言規則（詞首的 \' → ∅）不參與', () => {
    expect(of('kabadan')).toHaveProperty('kabat', 'suffix:an')
    expect(of("ma'akux")).toHaveProperty('akux', 'prefix:ma')
    expect(of("kiput'an")).toHaveProperty("kiput'", 'suffix:an')
    expect(of("kiput'an")).not.toHaveProperty('kiput')
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

  it('語言設定檔的方言規則不參與：加了 r → w、ura → owa 的規則，結果完全相同', () => {
    const withRules = new CorrespondenceSearch({ model: MODEL, profile: { ...PROFILE, rules: [...(PROFILE.rules ?? []), { category: '假的', rules: [['r', 'w', 0.1], ['ura', 'owa', 0.1]] }] }, entries })
    for (const q of ['turu', 'kawas', 'turuk']) expect(withRules.search(q, { fuzziness: 'loose' })).toEqual(csr.search(q, { fuzziness: 'loose' }))
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
