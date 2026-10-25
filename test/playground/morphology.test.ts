/**
 * 展示版的構詞模型（src/playground/morphology.ts）：以文法（詞素＋允許的詞綴組合）編輯，與正式站台同一種設定檔寫法。
 *
 * 核心案例是 pausunguday ＝ p<a>u-sungud-ay：<a> 落在前綴 pu 裡面。單獨列出 pu-、<a>、-ay 搜尋拆不出來，
 * 要設定「允許的詞綴組合」（文法的組合規則）；真正的 pazeh-kaxabu 設定檔就是這樣寫的。
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expandGrammar, validateProfile, type GrammarSpec, type MorphologySpec } from '#bcdp'
import { newProject, validateProject, type PlaygroundProject } from '../../src/playground/project.ts'
import { createCitation, createRecord } from '../../src/schema/index.ts'
import { buildDerivationGraph, buildSearchIndex, SearchEngine } from '../../src/search/index.ts'
import {
  constructionsUsing,
  flatToGrammar,
  formsText,
  grammarOf,
  isGrammar,
  morphemeLabel,
  newConstruction,
  newMorpheme,
  removeMorpheme,
  setForms,
  setGloss,
} from '../../src/playground/morphology.ts'

const SAMPLE: PlaygroundProject = JSON.parse(readFileSync(new URL('../../examples/playground/sample-project.json', import.meta.url), 'utf8'))
const PROFILE = { format: 'babizu-language-profile', version: 1, rules: [] } as const
const ALTERNATION = { underlying: 't', surface: 'd', position: 'final' } as const

/** 工作區裡真正的 pazeh-kaxabu 設定檔（只有三個 repo 放在一起時才有；babizu 單獨的 CI 沒有） */
const REAL_PATH = new URL('../../../pazeh-kaxabu/language/pazeh-kaxabu.json', import.meta.url)
const HAS_REAL = existsSync(REAL_PATH)
const REAL = HAS_REAL ? JSON.parse(readFileSync(REAL_PATH, 'utf8')) : null

/**
 * 精簡的正式站台寫法（取自 pazeh-kaxabu 的結構）：同位詞素 AF（m、mu、mi、me）、只在組合裡出現的詞素、
 * 非自由的 pre.pu、中綴 PROG、後綴 IRR、重疊，以及 AF.IRR 與 PU.IRR 兩條組合規則。
 */
const REAL_STYLE = {
  ...PROFILE,
  morphology: {
    cost: 0.2,
    minStem: 3,
    glides: 'iu',
    morphemes: [
      { id: 'AF', type: 'prefix', forms: ['m', 'mu', 'mi', 'me'], gloss: { 'zh-TW': '主事焦點', en: 'AF' }, ref: 'Lim & Zeitoun 2024', note: '同位詞素' },
      { id: 'AF.m', type: 'prefix', form: 'm', free: false },
      { id: 'pre.pu', type: 'prefix', form: 'pu', free: false },
      { id: 'PROG', type: 'infix', form: 'a', gloss: { 'zh-TW': '非完成貌', en: 'PROG' } },
      { id: 'IRR', type: 'suffix', form: 'ay', gloss: { 'zh-TW': '非實現', en: 'IRR' } },
      { id: 'RED.CV', type: 'reduplication', pattern: 'CV', gloss: { 'zh-TW': '進行', en: 'PROG' } },
    ],
    constructions: [
      { id: 'AF.IRR', sequence: ['AF.m', 'PROG', 'IRR'], gloss: { 'zh-TW': '主事焦點・非實現', en: 'AV.IRR' } },
      { id: 'PU.IRR', sequence: ['pre.pu', 'PROG', 'IRR'], gloss: { 'zh-TW': '鋪設・非實現', en: 'pave.IRR' }, note: 'p<a>u-…-ay' },
    ],
    alternations: [ALTERNATION],
  },
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))


/** 詞庫與設定 → 搜尋函式（建一次索引，查很多次）：命中的詞、命中方式、拆法 */
function engineFor(profile: object, words: string[]) {
  const items = words.map((w, k) => ({ record: createRecord({ source: 'd', localId: `w${k}`, unit: 'word', text: w, citation: createCitation(`w${k}`) }), shard: 'a' }))
  const data = JSON.parse(JSON.stringify(buildSearchIndex({ items, groups: [], sourceIds: ['d'], profile: profile as never })))
  const engine = new SearchEngine({ ...data, derivations: buildDerivationGraph(data) })
  return (query: string) => engine.search(query, { fields: ['native'] }).entries.map((h) => ({ term: h.doc.text, matchType: h.matchType, stem: h.analysis?.stem, steps: h.analysis?.steps.map((s) => s.form) }))
}
const search = (profile: object, words: string[], query: string) => engineFor(profile, words)(query)

describe('pausunguday ＝ p<a>u-sungud-ay：允許的詞綴組合', () => {
  const shared = { cost: 0.2, minStem: 3, alternations: [ALTERNATION] }
  const flat: MorphologySpec = { ...shared, prefixes: [{ form: 'pu' }], infixes: [{ form: 'a' }], suffixes: [{ form: 'ay' }] }
  const grammar: GrammarSpec = {
    ...shared,
    morphemes: [
      { id: 'prefix.pu', type: 'prefix', form: 'pu', free: false },
      { id: 'infix.a', type: 'infix', form: 'a', free: false },
      { id: 'suffix.ay', type: 'suffix', form: 'ay', free: false },
    ],
    constructions: [{ id: 'PU.IRR', sequence: ['prefix.pu', 'infix.a', 'suffix.ay'], gloss: { 'zh-TW': '鋪設・非實現', en: 'pave.IRR' } }],
  }

  it('單獨列出 pu-、<a>、-ay：拆不出來（<a> 只會插在詞根裡，表面是 pusaungutay，不是 pausunguday）', () => {
    expect(search({ ...PROFILE, morphology: flat }, ['sungut'], 'pausunguday')).toEqual([])
  })

  it('設定「pu- ＋ <a> ＋ -ay」這個組合：拆成 sungut 與一個構式，交界的 t → d 照樣適用', () => {
    expect(validateProfile({ ...PROFILE, morphology: grammar })).toEqual([])
    const hits = search({ ...PROFILE, morphology: grammar }, ['sungut'], 'pausunguday')
    expect(hits).toMatchObject([{ term: 'sungut', matchType: 'lemma', stem: 'sungut' }])
  })

  it('展開後的步驟帶著詞素（說明顯示 p<a>u-…-ay，由 pu、a、ay 三個詞素構成）', () => {
    const expanded = expandGrammar(grammar)
    const step = expanded.circumfixes.find((c) => c.prefix === 'pau')
    expect(step).toMatchObject({ prefix: 'pau', suffix: 'ay' })
    expect(step?.parts?.map((p) => `${p.type}:${p.form}`)).toEqual(['prefix:pu', 'infix:a', 'suffix:ay'])
  })

  it('詞素 free: false（只出現在組合裡）：沒有組合規則的 pu- 不能單獨拆', () => {
    const only = { ...grammar, constructions: [] }
    expect(search({ ...PROFILE, morphology: only }, ['sungut'], 'pusungut')).toEqual([])
    // 自由的 pu- 可以單獨拆
    const freePrefix = { ...only, morphemes: [{ id: 'prefix.pu', type: 'prefix', form: 'pu' }] } as GrammarSpec
    expect(search({ ...PROFILE, morphology: freePrefix }, ['sungut'], 'pusungut')).toMatchObject([{ term: 'sungut', matchType: 'lemma' }])
  })

  it('正式站台寫法的設定檔（同位詞素、組合規則含 PU.IRR）拆得出來', () => {
    expect(validateProfile(REAL_STYLE)).toEqual([])
    expect(search(REAL_STYLE, ['sungut'], 'pausunguday')).toMatchObject([{ term: 'sungut', matchType: 'lemma', stem: 'sungut' }])
  })

  it.skipIf(!HAS_REAL)('工作區裡真正的 pazeh-kaxabu 設定檔：同一份設定檔（含 PU.IRR）拆得出來', () => {
    expect(search(REAL, ['sungut'], 'pausunguday')).toMatchObject([{ term: 'sungut', matchType: 'lemma', stem: 'sungut' }])
  })
})

describe('平面清單 → 文法', () => {
  it('每個詞綴一個自由詞素（順序：前綴、後綴、中綴、重疊），環綴變成組合規則，說明與成本保留', () => {
    const flat = SAMPLE.profile.morphology as MorphologySpec
    const result = flatToGrammar(flat)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const g = result.grammar
    expect(g.morphemes?.filter((m) => m.free !== false).map((m) => `${m.type}:${m.form ?? m.pattern}`)).toEqual([
      ...(flat.prefixes ?? []).map((a) => `prefix:${a.form}`),
      ...(flat.suffixes ?? []).map((a) => `suffix:${a.form}`),
      ...(flat.infixes ?? []).map((a) => `infix:${a.form}`),
      ...(flat.reduplication ?? []).map((r) => `reduplication:${r.pattern}`),
    ])
    expect(g.constructions).toHaveLength(flat.circumfixes?.length ?? 0)
    // 與平面清單共用的欄位照抄；沒有平面的五張表
    expect(g.alternations).toEqual(flat.alternations)
    expect(g.minStem).toBe(flat.minStem)
    expect(g).not.toHaveProperty('prefixes')
    expect(validateProfile({ ...SAMPLE.profile, morphology: g })).toEqual([])
  })

  it('展開後與原本的平面清單相同（除了文法多產生的元音開頭詞根串接形式）', () => {
    const flat = SAMPLE.profile.morphology as MorphologySpec
    const result = flatToGrammar(flat)
    if (!result.ok) throw new Error(result.reason)
    const expanded = expandGrammar(result.grammar)
    // 展開時每一項都填上成本；平面清單省略時用的是同一個預設（規格的 cost）
    const strip = (list: object[] | undefined) =>
      (list ?? []).map((e) => {
        const { rank: _rank, parts: _parts, ...rest } = { cost: flat.cost, ...(e as Record<string, unknown>) } as Record<string, unknown>
        return JSON.stringify(Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b))))
      })
    for (const key of ['prefixes', 'suffixes', 'infixes', 'reduplication'] as const) expect(strip(expanded[key]).sort(), key).toEqual(strip(flat[key]).sort())
    // 環綴：文法多出的只有 stemInitial 的串接形式
    expect(strip(expanded.circumfixes.filter((c) => !c.stemInitial)).sort()).toEqual(strip(flat.circumfixes).sort())
    expect(expanded.circumfixes.filter((c) => c.stemInitial).map((c) => c.prefix)).toEqual(['ma'])
  })

  it('範例專案的詞庫：轉成文法之後，每個詞當查詢的命中方式與拆法不變（只有 m<a>-…-ay 在元音開頭詞根上更接近真正的辭典）', () => {
    const flat = SAMPLE.profile.morphology as MorphologySpec
    const result = flatToGrammar(flat)
    if (!result.ok) throw new Error(result.reason)
    const words = SAMPLE.words.map((w) => w.text)
    const queries = [...new Set([...words, 'mubaket', 'minubaket', 'tabaketaw', 'mausay', 'kikiliw'])]
    let compared = 0
    const differences: string[] = []
    const searchFlat = engineFor({ ...SAMPLE.profile, morphology: flat }, words)
    const searchGrammar = engineFor({ ...SAMPLE.profile, morphology: result.grammar }, words)
    for (const q of queries) {
      const a = searchFlat(q)
      const b = searchGrammar(q)
      compared++
      if (JSON.stringify(a.map((h) => [h.term, h.matchType, h.stem])) !== JSON.stringify(b.map((h) => [h.term, h.matchType, h.stem]))) differences.push(q)
    }
    expect(compared).toBeGreaterThan(60)
    // 差異只可能來自 m<a>-…-ay 的串接形式（查詢以 ma 開頭、後綴 ay、詞根元音開頭）
    expect(differences.filter((q) => !/^ma.*ay$/u.test(q))).toEqual([])
  })

  it('轉不了的回報原因：手寫的 stemInitial、有元音的前綴加中綴', () => {
    const stemInitial = flatToGrammar({ circumfixes: [{ prefix: 'ma', suffix: 'ay', stemInitial: 'V' }] })
    expect(stemInitial).toMatchObject({ ok: false })
    expect(stemInitial.ok ? '' : stemInitial.reason).toMatch(/stemInitial/u)
    const vowelPrefix = flatToGrammar({ circumfixes: [{ prefix: 'mu', infix: 'in', suffix: 'an' }] })
    expect(vowelPrefix.ok ? '' : vowelPrefix.reason).toMatch(/中綴落在詞根上/u)
  })

  it('環綴兩側已經是自由詞綴就引用它；重疊式環綴的重疊排在第一個', () => {
    const r = flatToGrammar({ prefixes: [{ form: 'ta' }], circumfixes: [{ prefix: 'ta', suffix: 'aw' }, { reduplication: 'Ca', suffix: 'ay' }] })
    if (!r.ok) throw new Error(r.reason)
    const [taaw, caay] = r.grammar.constructions ?? []
    expect(taaw.sequence[0]).toBe('prefix.ta')
    expect(r.grammar.morphemes?.filter((m) => m.type === 'prefix')).toHaveLength(1)
    const byId = new Map(r.grammar.morphemes?.map((m) => [m.id, m]))
    expect(caay.sequence.map((id) => byId.get(id)?.type)).toEqual(['reduplication', 'suffix'])
    expect(validateProfile({ ...PROFILE, morphology: r.grammar })).toEqual([])
  })
})

describe('與正式站台的設定檔相容', () => {
  it('文法寫法的設定檔原樣用來編輯（不轉換、不遺失 forms、free、ref、note）', () => {
    expect(grammarOf(REAL_STYLE.morphology)).toEqual({ ok: true, grammar: REAL_STYLE.morphology })
    expect(isGrammar(REAL_STYLE.morphology)).toBe(true)
  })

  it('整份設定檔放進專案：檢查通過，沒有 error', () => {
    const project: PlaygroundProject = { ...newProject(), profile: clone(REAL_STYLE) as never }
    expect(validateProject(project).filter((i) => i.level === 'error')).toEqual([])
  })

  it.skipIf(!HAS_REAL)('工作區裡真正的 pazeh-kaxabu 設定檔：原樣用來編輯，放進專案檢查通過', () => {
    expect(grammarOf(REAL.morphology)).toEqual({ ok: true, grammar: REAL.morphology })
    const project: PlaygroundProject = { ...newProject(), varieties: [{ code: 'pazeh', label: 'pazeh' }, { code: 'kaxabu', label: 'kaxabu' }], profile: clone(REAL) }
    expect(validateProject(project).filter((i) => i.level === 'error')).toEqual([])
  })
})

describe('文法寫法的專案檢查：說明是哪一列', () => {
  const grammarProject = (morphology: object): PlaygroundProject => ({ ...newProject(), profile: { ...PROFILE, morphology } as never })

  it('詞素沒有寫法、寫成 ma-、有空白；組合少於兩個詞素或有詞素已刪除', () => {
    const messages = validateProject(
      grammarProject({
        morphemes: [
          { id: 'prefix.1', type: 'prefix', form: '' },
          { id: 'prefix.2', type: 'prefix', form: 'ma-' },
          { id: 'suffix.1', type: 'suffix', form: 'a y' },
          { id: 'suffix.2', type: 'suffix', form: 'ay' },
        ],
        constructions: [{ id: 'c1', sequence: ['prefix.2', 'gone'] }, { id: 'c2', sequence: ['prefix.2'] }],
      }),
    ).map((i) => `${i.path} ${i.message}`)
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^profile\.morphology\.morphemes\[0\] 構詞：前綴第 1 個沒有寫法/u),
        expect.stringMatching(/^profile\.morphology\.morphemes\[1\] 構詞：前綴「ma-」不用寫連字號/u),
        expect.stringMatching(/^profile\.morphology\.morphemes\[2\] 構詞：後綴「a y」不能有空白/u),
        expect.stringMatching(/^profile\.morphology\.constructions\[0\] 允許的詞綴組合第 1 個有詞素還沒選/u),
        expect.stringMatching(/^profile\.morphology\.constructions\[1\] 允許的詞綴組合第 2 個至少要有兩個詞素/u),
      ]),
    )
  })

  it('推導不出來的組合（兩個中綴都落在詞根上）：指出是第幾個組合與原因', () => {
    const issues = validateProject(
      grammarProject({
        morphemes: [{ id: 'infix.in', type: 'infix', form: 'in' }, { id: 'infix.a', type: 'infix', form: 'a' }],
        constructions: [{ id: 'c1', sequence: ['infix.in', 'infix.a'] }],
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ path: 'profile.morphology.constructions[0]', level: 'error' })
    expect(issues[0].message).toMatch(/^允許的詞綴組合第 1 個無法成立：.*也落在詞根上/u)
  })

  it('同一種詞綴、重疊型式列了兩次：提醒，不擋建置', () => {
    const issues = validateProject(
      grammarProject({
        morphemes: [{ id: 'prefix.1', type: 'prefix', form: 'mu' }, { id: 'prefix.2', type: 'prefix', form: 'mu' }, { id: 'red.1', type: 'reduplication', pattern: 'CV' }, { id: 'red.2', type: 'reduplication', pattern: 'CV' }],
      }),
    )
    expect(issues.map((i) => i.level)).toEqual(['warning', 'warning'])
  })
})

describe('編輯操作', () => {
  const base = (): GrammarSpec => ({ morphemes: [{ id: 'prefix.1', type: 'prefix', form: 'pu' }, { id: 'suffix.1', type: 'suffix', form: 'ay' }], constructions: [{ id: 'construction.1', sequence: ['prefix.1', 'suffix.1'] }] })

  it('新詞素與新組合規則的 id 不與現有的重複', () => {
    const g = base()
    expect(newMorpheme(g, 'prefix').id).toBe('prefix.2')
    expect(newMorpheme(g, 'infix')).toEqual({ id: 'infix.1', type: 'infix', form: '' })
    expect(newMorpheme(g, 'reduplication')).toEqual({ id: 'reduplication.1', type: 'reduplication', pattern: 'CV' })
    expect(newConstruction(g, ['prefix.1', 'suffix.1']).id).toBe('construction.2')
  })

  it('刪詞素：用到它的組合規則一併刪掉', () => {
    const g = base()
    expect(constructionsUsing(g, 'suffix.1').map((c) => c.id)).toEqual(['construction.1'])
    expect(removeMorpheme(g, 'suffix.1').map((c) => c.id)).toEqual(['construction.1'])
    expect(g.morphemes?.map((m) => m.id)).toEqual(['prefix.1'])
    expect(g.constructions).toEqual([])
  })

  it('形式：一個寫 form，以逗號或頓號分開的幾個寫 forms（同位詞素）', () => {
    const m = { id: 'x', type: 'prefix', form: 'm' } as GrammarSpec['morphemes'] extends (infer T)[] | undefined ? T : never
    setForms(m, 'm, mu、mi，me')
    expect(m).toEqual({ id: 'x', type: 'prefix', forms: ['m', 'mu', 'mi', 'me'] })
    expect(formsText(m)).toBe('m, mu, mi, me')
    expect(morphemeLabel(m)).toBe('m/mu/mi/me-')
    setForms(m, ' pu ')
    expect(m).toEqual({ id: 'x', type: 'prefix', form: 'pu' })
    setForms(m, '')
    expect(m.form).toBe('')
  })

  it('說明：字串直接寫；依語系的物件只改一個語系，其他語系保留；全空就刪掉欄位', () => {
    const a: { gloss?: string | Record<string, string> } = {}
    setGloss(a, '主事焦點', 'zh-TW')
    expect(a.gloss).toBe('主事焦點')
    setGloss(a, '', 'zh-TW')
    expect(a).toEqual({})
    const b = { gloss: { 'zh-TW': '主事焦點', en: 'AF' } }
    setGloss(b, '主事', 'zh-TW')
    expect(b.gloss).toEqual({ 'zh-TW': '主事', en: 'AF' })
    setGloss(b, '', 'zh-TW')
    setGloss(b, '', 'en')
    expect(b).toEqual({})
  })
})
