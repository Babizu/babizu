/**
 * 構詞文法（src/fuzzy/grammar.js）：規格檢查、展開（編譯）的結果、編譯原理的引理，以及以文法搜尋的固定案例。
 *
 * 文法只在載入時展開成平面清單，搜尋就是原本的 BCDP（它與窮舉參考實作的比對在 bcdp-reference.test.js，
 * 隨機規格也含展開後才有的包覆單位形狀）。這裡檢查的是展開本身：
 * - 固定的例子逐項比對；
 * - 引理：把詞素序列直接套在詞根上（這裡另外寫的具體推導），結果等於展開出的 L · op(詞根) · R，
 *   隨機的序列 × 元音開頭、輔音開頭的詞根都要成立；去詞綴（字面的開放詞幹）的每個分析，generate 也要還原出同一個詞形。
 */

import { describe, expect, it } from 'vitest'
import { validateMorphology } from '../../src/fuzzy/morphology.js'
import { evaluate, expandGrammar } from '../../src/fuzzy/grammar.js'
import { createCitation, createRecord, createSense } from '../../src/schema/index.js'
import { SearchEngine, buildDerivationGraph, buildSearchIndex } from '../../src/search/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'
import { createRandom, pick } from './helpers.js'
import { openAnalyzer } from './open-stems.js'

/** 仿照巴宰語：主事焦點 m-／mu-／mi-／me-、非完成貌 <a>、完成貌 <in>、非實現 -ay（docs/morph-grammar.md） */
export const GRAMMAR = {
  cost: 0.2,
  minStem: 3,
  maxSteps: 3,
  morphemes: [
    { id: 'AF', type: 'prefix', forms: ['m', 'mu', 'mi', 'me'], gloss: { 'zh-TW': '主事焦點', en: 'AF' } },
    { id: 'STAT', type: 'prefix', form: 'ma', gloss: { 'zh-TW': '靜態', en: 'STAT' } },
    { id: 'KA', type: 'prefix', form: 'ka' },
    { id: 'TU', type: 'prefix', form: 'tu' },
    { id: 'IF', type: 'prefix', form: 'sa' },
    { id: 'PROG', type: 'infix', form: 'a', gloss: { 'zh-TW': '非完成貌', en: 'PROG' } },
    { id: 'PRF', type: 'infix', form: 'in', gloss: { 'zh-TW': '完成貌', en: 'PRF' } },
    { id: 'IRR', type: 'suffix', form: 'ay', gloss: { 'zh-TW': '非實現', en: 'IRR' } },
    { id: 'LF', type: 'suffix', form: 'an' },
    { id: 'RED.CV', type: 'reduplication', pattern: 'CV' },
    { id: 'HORT', type: 'prefix', form: 'ta', free: false },
    { id: 'HORT.aw', type: 'suffix', form: 'aw', free: false },
  ],
  constructions: [
    { id: 'AF.PFV', sequence: ['AF', 'PRF'], gloss: { 'zh-TW': '主事焦點・完成', en: 'AF.PFV' } },
    { id: 'KA.PFV', sequence: ['KA', 'PRF'] },
    { id: 'AF.PROG', sequence: ['AF', 'PROG'], gloss: { 'zh-TW': '主事焦點・非完成', en: 'AF.PROG' } },
    { id: 'AF.IRR', sequence: ['AF', 'PROG', 'IRR'], gloss: { 'zh-TW': '主事焦點・非實現', en: 'AF.IRR' } },
    { id: 'STAT.IRR', sequence: ['STAT', 'IRR'], gloss: { 'zh-TW': '靜態・非實現', en: 'STAT.IRR' } },
    { id: 'UVL.PFV', sequence: ['PRF', 'LF'] },
    { id: 'LF.IRR', sequence: ['LF', 'IRR'] },
    { id: 'UVL.PROG', sequence: ['RED.CV', 'IF'] },
    { id: 'HORT.UVP', sequence: ['HORT', 'HORT.aw'] },
  ],
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'é', 'ə'])

describe('規格檢查', () => {
  it('例子通過；平面清單寫法照舊', () => {
    expect(validateMorphology(GRAMMAR)).toEqual([])
    expect(validateMorphology({ prefixes: [{ form: 'mu' }] })).toEqual([])
  })

  it('每一種錯誤都有具體的訊息', () => {
    const bad = (/** @type {any} */ patch) => validateMorphology({ ...GRAMMAR, ...patch }).join('\n')
    expect(bad({ prefixes: [{ form: 'mu' }] })).toMatch(/不能同時使用文法寫法/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', form: '' }] })).toMatch(/form 必須是非空字串/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', form: 'a b' }] })).toMatch(/不能含空白/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', form: 'mu', forms: ['mu'] }] })).toMatch(/form 或 forms（恰好一個）/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', forms: ['mu', 'mu'] }] })).toMatch(/重複的形式/)
    expect(bad({ morphemes: [{ id: 'X', type: 'reduplication', pattern: 'CCV' }] })).toMatch(/pattern 必須是/)
    expect(bad({ morphemes: [{ id: 'X', type: 'circumfix', form: 'a' }] })).toMatch(/type 必須是/)
    expect(bad({ morphemes: [...GRAMMAR.morphemes, { id: 'AF', type: 'prefix', form: 'x' }] })).toMatch(/「AF」重複/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', form: 'mu', when: '^V' }] })).toMatch(/when 是未知的欄位/)
    expect(bad({ conditionPenalty: 0.3 })).toMatch(/conditionPenalty 是未知的欄位/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['AF', 'NOPE'] }] })).toMatch(/不存在的詞素：NOPE/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['AF'] }] })).toMatch(/至少兩個/)
    expect(bad({ constructions: [{ id: 'AF', sequence: ['AF', 'IRR'] }] })).toMatch(/組合規則與詞素的 id 不能相同/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['AF', 'RED.CV'] }] })).toMatch(/重疊只能是第一個/)
    // m ＋ <a>：中綴落在詞根上；再插入 <in> 就是詞根上的第二個運算（mu 的選擇則都落在前綴上，不算錯）
    expect(bad({ constructions: [{ id: 'Q', sequence: ['AF', 'PROG', 'PRF'] }] })).toMatch(/Q，m ＋ a ＋ in.*只能有一個詞根上的中綴或重疊/)
  })
})

describe('展開（編譯）', () => {
  const flat = expandGrammar(GRAMMAR)
  /** @param {any} e */
  const show = (e) =>
    e.form ??
    e.pattern ??
    `${e.prefix ?? ''}|${e.infix ?? e.reduplication ?? ''}|${e.suffix ?? ''}${e.stemInitial ? `|${e.stemInitial}` : ''}`

  it('只有一側的組合規則是一般的詞綴：mu ＋ <in> → minu（插在前綴的首輔音之後）；自由詞素在前、組合規則在後', () => {
    expect(flat.prefixes.map(show)).toEqual(['m', 'mu', 'mi', 'me', 'ma', 'ka', 'tu', 'sa', 'minu', 'mini', 'mine', 'kina', 'mau', 'mai', 'mae'])
    expect(flat.suffixes.map(show)).toEqual(['ay', 'an', 'anay'])
    expect(flat.prefixes.find((/** @type {any} */ e) => e.form === 'minu')).toMatchObject({ parts: [{ id: 'AF', form: 'mu' }, { id: 'PRF', form: 'in' }], gloss: { en: 'AF.PFV' }, cost: 0.2 })
    // rank：自由詞素在前、組合規則在後（成本與步驟數都相同時，說明選較前的）
    const minu = flat.prefixes.find((/** @type {any} */ e) => e.form === 'minu')
    const mu = flat.prefixes.find((/** @type {any} */ e) => e.form === 'mu')
    expect(mu.rank).toBeLessThan(minu.rank)
  })

  it('包覆單位：m ＋ 中綴（詞根上的中綴，外側緊貼 m），加上它在元音開頭的詞根上的串接形式；詞根上的重疊與後綴、前綴', () => {
    expect(flat.circumfixes.map(show)).toEqual([
      'min|||V',
      'm|in|',
      'ma|||V',
      'm|a|',
      'ma||ay|V',
      'm|a|ay',
      'mau||ay',
      'mai||ay',
      'mae||ay',
      'ma||ay',
      '|in|an',
      'sa|CV|',
      'ta||aw',
    ])
    // 同一種選擇展開的兩項，說明與順序都相同
    expect(flat.circumfixes[4]).toMatchObject({ parts: [{ id: 'AF' }, { id: 'PROG' }, { id: 'IRR' }], rank: flat.circumfixes[5].rank })
    expect(flat.infixes.map(show)).toEqual(['a', 'in'])
    expect(flat.reduplication.map(show)).toEqual(['CV'])
  })

  it('bound（free: false）的詞素不單獨出現；展開後的規格照樣通過平面清單的檢查', () => {
    expect([...flat.prefixes, ...flat.suffixes].some((e) => e.form === 'ta' || e.form === 'aw')).toBe(false)
    const { parts: _p, rank: _r, ...rest } = /** @type {any} */ (flat.circumfixes[0])
    expect(validateMorphology({ circumfixes: [rest], prefixes: flat.prefixes.map(({ form }) => ({ form })) })).toEqual([])
  })
})

describe('引理：展開出的 L · op(詞根) · R 等於把序列直接套在詞根上', () => {
  /**
   * 具體的推導（定義）：依序套用在目前的詞形上。中綴插在整個詞形的首輔音之後；重疊只能是第一個。
   * @param {string} root
   * @param {Array<{type: string, form: string}>} seq
   */
  const concrete = (root, seq) => {
    let w = root
    for (const s of seq) {
      if (s.type === 'prefix') w = s.form + w
      else if (s.type === 'suffix') w = w + s.form
      else if (s.type === 'infix') {
        let h = 0
        while (h < w.length && !VOWELS.has(w[h])) h++
        w = w.slice(0, h) + s.form + w.slice(h)
      } else {
        let v = 0
        while (v < w.length && !VOWELS.has(w[v])) v++
        w = w.slice(0, v + 1) + w // CV
      }
    }
    return w
  }

  it('隨機的序列 × 元音開頭、輔音開頭的詞根；分析器的 generate 還原出同一個詞形', () => {
    const random = createRandom(2718)
    const roots = ['usa', 'udan', 'aping', 'baket', 'kita', 'tbak', 'nnt']
    const pieces = [
      { type: 'prefix', form: 'm' },
      { type: 'prefix', form: 'mu' },
      { type: 'prefix', form: 'pa' },
      { type: 'prefix', form: 'k' },
      { type: 'suffix', form: 'ay' },
      { type: 'suffix', form: 'an' },
      { type: 'infix', form: 'a' },
      { type: 'infix', form: 'in' },
    ]
    let checked = 0
    for (let round = 0; round < 400; round++) {
      const seq = Array.from({ length: 2 + Math.floor(random() * 3) }, () => pick(random, pieces))
      if (random() < 0.2) seq.unshift({ type: 'reduplication', form: 'CV' })
      const r = evaluate(seq, VOWELS)
      if (r.error) continue
      for (const root of roots) {
        const want = concrete(root, seq)
        let core = root
        if (r.op?.type === 'infix') {
          let h = 0
          while (h < root.length && !VOWELS.has(root[h])) h++
          core = root.slice(0, h) + r.op.form + root.slice(h)
        } else if (r.op) {
          let v = 0
          while (v < root.length && !VOWELS.has(root[v])) v++
          if (v === root.length) continue // 沒有元音的詞根不能 CV 重疊
          core = root.slice(0, v + 1) + root
        }
        expect(r.L + core + r.R, `${JSON.stringify(seq)} ＋ ${root}`).toBe(want)
        // 元音開頭的詞根上，詞根上的中綴緊接在 L 之後：串接的 L·x 也得到同一個詞形
        if (r.op?.type === 'infix' && r.L && VOWELS.has(root[0])) expect(r.L + r.op.form + root + r.R).toBe(want)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)

    // 去詞綴由展開後的項目還原：沒有構詞音變的分析，步驟加回詞根得到同樣的詞形
    const open = openAnalyzer(GRAMMAR)
    const analyzer = open.analyzer
    for (const root of ['usa', 'baket']) {
      const w = analyzer.generate(root, [{ type: 'circumfix', form: '', left: { type: 'infix', form: 'a' }, outer: 'm', suffix: 'ay', gloss: null, cost: 0.2 }])
      const analyses = open.analyze(w).filter((a) => Math.abs(a.cost - a.steps.reduce((x, st) => x + st.cost, 0)) < 1e-9)
      expect(analyses.some((a) => a.stem === root)).toBe(true)
      for (const a of analyses) expect(analyzer.generate(a.stem, [...a.steps]), `${w} ← ${a.stem}`).toBe(w)
    }
    expect(analyzer.generate('usa', [{ type: 'circumfix', form: '', left: { type: 'infix', form: 'a' }, outer: 'm', suffix: 'ay', gloss: null, cost: 0.2 }])).toBe('mausaay')
    expect(analyzer.generate('baket', [{ type: 'circumfix', form: '', left: { type: 'infix', form: 'a' }, outer: 'm', suffix: 'ay', gloss: null, cost: 0.2 }])).toBe('mbaaketay')
  })
})

describe('以文法搜尋（原本的 BCDP，只多了包覆單位）', () => {
  /** @param {string} localId @param {string} text */
  const rec = (localId, text) => createRecord({ source: 'dict', localId, unit: 'word', text, citation: createCitation(`dict ${localId}`) }, { senses: [createSense({ zh: text })] })
  const records = ['usa', 'udan', 'baket', 'babaw', 'kita'].map((w) => rec(w, w))
  const built = buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: GRAMMAR } })
  const engine = new SearchEngine(JSON.parse(JSON.stringify(built)))
  /** @param {string} q @param {string} id */
  const analysisOf = (q, id) => engine.search(q, { fields: ['native'] }).entries.find((h) => h.doc.id === id)?.analysis
  /** 步驟寫成「詞素 id＝形式」：組合規則是幾個詞素接起來 @param {any} a */
  const partsOf = (a) => a?.steps.map((/** @type {any} */ s) => (s.parts ?? []).map((/** @type {any} */ p) => `${p.id}=${p.form}`).join('+') || `${s.type}:${s.form}`)

  it('mausay、maudanay → 組合規則 AF.IRR（m- ＋ <a> ＋ -ay）；usa｜ay 的元音合併照樣適用', () => {
    expect(partsOf(analysisOf('mausay', 'dict:usa'))).toEqual(['AF=m+PROG=a+IRR=ay'])
    expect(partsOf(analysisOf('maudanay', 'dict:udan'))).toEqual(['AF=m+PROG=a+IRR=ay'])
  })

  it('m<a>- 只接元音開頭的詞根（中綴位置的推論）：mbaaket → m- ＋ b<a>aket，mabaket 只能是 ma-；mausa 的 ma- 與 m<a>- 同分，說明選自由詞素', () => {
    expect(partsOf(analysisOf('mbaaket', 'dict:baket'))).toEqual(['AF=m+PROG=a'])
    expect(partsOf(analysisOf('mabaket', 'dict:baket'))).toEqual(['STAT=ma'])
    expect(partsOf(analysisOf('mausa', 'dict:usa'))).toEqual(['STAT=ma'])
  })

  it('minubaket → AF.PFV（m<in>u-）；mubinaket → mu- ＋ <in>（兩個自由步驟）；kinatubabaw → kina- ＋ tu-（組合規則也可以不在最內層）', () => {
    expect(partsOf(analysisOf('minubaket', 'dict:baket'))).toEqual(['AF=mu+PRF=in'])
    const a = analysisOf('mubinaket', 'dict:baket')
    expect(partsOf(a)).toEqual(['AF=mu', 'PRF=in'])
    expect(a?.cost).toBeCloseTo(0.4)
    expect(partsOf(analysisOf('kinatubabaw', 'dict:babaw'))).toEqual(['KA=ka+PRF=in', 'TU=tu'])
  })

  it('詞根上的重疊之後再加前綴（sa-RED）是一個組合規則；只有後綴的組合規則（-an-ay）是一個後綴', () => {
    expect(partsOf(analysisOf('sakikita', 'dict:kita'))).toEqual(['RED.CV=CV+IF=sa'])
    expect(partsOf(analysisOf('kitaanay', 'dict:kita'))).toEqual(['LF=an+IRR=ay'])
  })

  it('自動派生：查 usa 找到 mausay（辭典沒有標註，由構詞分析連起來），說明是 AF.IRR', () => {
    const recs = ['usa', 'mausay'].map((w) => rec(w, w))
    const b = buildSearchIndex({ items: recs.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: GRAMMAR } })
    const data = JSON.parse(JSON.stringify(b))
    const hit = new SearchEngine({ ...data, derivations: buildDerivationGraph(data) }).search('usa', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:mausay')
    expect(hit?.matchType).toBe('derived')
    expect(partsOf(hit?.analysis)).toEqual(['AF=m+PROG=a+IRR=ay'])
  })
})
