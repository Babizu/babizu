/**
 * 構詞文法（src/fuzzy/grammar/）：規格驗證、推導產生器、編譯成 BCDP 的平面結構，以及以文法搜尋。
 * 規格仿照 docs/morph-grammar.md 第 3 節的例子（巴宰語的主事焦點 AF、非完成貌 <a>、完成貌 <in>、非實現 -ay）。
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, validateMorphology } from '../../../src/fuzzy/morphology.js'
import { ACCEPT } from '../../../src/fuzzy/grammar/conditions.js'
import { compileGrammar } from '../../../src/fuzzy/grammar/compile.js'
import { derive } from '../../../src/fuzzy/grammar/derive.js'
import { normalizeGrammar } from '../../../src/fuzzy/grammar/spec.js'
import { createCitation, createRecord, createSense } from '../../../src/schema/index.js'
import { SearchEngine, buildSearchIndex } from '../../../src/search/index.js'
import { PAZEH_PROFILE } from '../../fixtures/pazeh.js'

export const GRAMMAR = {
  cost: 0.2,
  minStem: 3,
  maxSteps: 3,
  morphemes: [
    {
      id: 'AF',
      type: 'prefix',
      gloss: { 'zh-TW': '主事焦點', en: 'AF' },
      allomorphs: [
        { form: 'm', when: '^V' },
        { form: 'mu', when: '^C+[ua]' },
        { form: 'mi', when: '^C+i' },
        { form: 'me', when: '^C+e' },
      ],
    },
    { id: 'STAT', type: 'prefix', form: 'ma', gloss: { 'zh-TW': '靜態', en: 'STAT' } },
    { id: 'CAUS', type: 'prefix', form: 'pa', gloss: { 'zh-TW': '使役', en: 'CAUS' } },
    { id: 'PROG', type: 'infix', form: 'a', gloss: { 'zh-TW': '非完成貌', en: 'PROG' } },
    { id: 'PRF', type: 'infix', form: 'in', gloss: { 'zh-TW': '完成貌', en: 'PRF' } },
    { id: 'IRR', type: 'suffix', form: 'ay', gloss: { 'zh-TW': '非實現', en: 'IRR' } },
    { id: 'LF', type: 'suffix', form: 'an', gloss: { 'zh-TW': '處所焦點', en: 'LF' } },
    { id: 'PF', type: 'suffix', allomorphs: [{ form: 'en' }, { form: 'un', when: 'uC*$' }], gloss: { 'zh-TW': '受事焦點', en: 'PF' } },
  ],
  constructions: [
    { id: 'AF.IRR', sequence: ['AF', 'PROG', 'IRR'], gloss: { 'zh-TW': '主事焦點・非實現', en: 'AF.IRR' } },
    { id: 'AF.PRF', sequence: ['AF', 'PRF'], gloss: { 'zh-TW': '主事焦點・完成', en: 'AF.PRF' } },
    { id: 'LF.PRF', sequence: ['PRF', 'LF'], gloss: { 'zh-TW': '處所焦點・完成', en: 'LF.PRF' } },
  ],
}

const g = normalizeGrammar(GRAMMAR)

describe('規格驗證', () => {
  it('文法寫法的例子通過驗證；平面清單寫法照舊', () => {
    expect(validateMorphology(GRAMMAR)).toEqual([])
    expect(validateMorphology({ prefixes: [{ form: 'mu' }] })).toEqual([])
  })

  it('每一種錯誤都有具體的訊息', () => {
    const bad = (/** @type {any} */ patch) => validateMorphology({ ...GRAMMAR, ...patch }).join('\n')
    expect(bad({ prefixes: [{ form: 'mu' }] })).toMatch(/不能同時使用文法/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', form: '' }] })).toMatch(/非空字串（空的詞素會讓剖析無法停止）/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', form: 'mu', when: 'uC*$' }] })).toMatch(/錨點不對/)
    expect(bad({ morphemes: [{ id: 'X', type: 'suffix', form: 'an', when: '^V' }] })).toMatch(/錨點不對/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', form: 'mu', when: '^(a+)+' }] })).toMatch(/when/)
    expect(bad({ morphemes: [{ id: 'X', type: 'reduplication', pattern: 'CCV' }] })).toMatch(/pattern 必須是/)
    expect(bad({ morphemes: [...GRAMMAR.morphemes, { id: 'AF', type: 'prefix', form: 'x' }] })).toMatch(/重複/)
    expect(bad({ morphemes: [{ id: 'X', type: 'prefix', form: 'mu', maxUses: 9 }] })).toMatch(/maxUses/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['AF', 'NOPE'] }] })).toMatch(/不存在的詞素：NOPE/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['PRF', 'AF'] }] })).toMatch(/詞根上的中綴之後只能再接後綴/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['LF', 'IRR'] }] })).toMatch(/只有後綴的組合規則尚未支援/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['AF', 'PROG', 'PRF'] }] })).toMatch(/至多一個中綴/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['AF', 'AF'] }] })).toMatch(/超過它的 maxUses/)
    expect(bad({ constructions: [{ id: 'Q', sequence: ['AF'] }] })).toMatch(/至少兩個/)
  })
})

describe('推導產生器', () => {
  const surface = (/** @type {string} */ root, /** @type {string[]} */ ids, /** @type {number[]} */ al = []) =>
    derive(g, root, ids.map((id, k) => ({ id, allomorph: al[k] ?? 0 })))

  it('docs/morph-grammar.md 2.3 的例子', () => {
    expect(surface('usa', ['AF', 'PROG', 'IRR']).surface).toBe('mausaay') // aa → a 是音變，不在推導裡
    expect(surface('udan', ['AF', 'PROG', 'IRR']).surface).toBe('maudanay')
    expect(surface('baket', ['AF', 'PRF'], [1]).surface).toBe('minubaket')
    expect(surface('baket', ['PRF', 'AF'], [0, 1]).surface).toBe('mubinaket')
    expect(surface('baket', ['PRF']).surface).toBe('binaket')
  })

  it('交界：中綴把基底切開，兩側都是交界', () => {
    const d = surface('usa', ['AF', 'PROG', 'IRR'])
    expect(d.junctions).toEqual([1, 2, 5]) // m｜a｜usa｜ay
  })

  it('條件：m- 只接元音開頭；mu- 接第一個元音是 u、a 的輔音開頭；後綴 -un 看詞根最後一個元音', () => {
    expect(surface('usa', ['AF'], [0]).satisfied).toEqual([true])
    expect(surface('baket', ['AF'], [0]).satisfied).toEqual([false])
    expect(surface('baket', ['AF'], [1]).satisfied).toEqual([true])
    expect(surface('kita', ['AF'], [1]).satisfied).toEqual([false])
    expect(surface('bitud', ['PF'], [1]).satisfied).toEqual([true])
    expect(surface('kawas', ['PF'], [1]).satisfied).toEqual([false])
  })

  it('條件讀的範圍：前綴不讀後綴、後綴不讀前綴、詞根上的中綴略過', () => {
    // mu- 加在 b<in>aket 上：條件對 baket 檢查（第一個元音是 a），不是 binaket（第一個元音是 i）
    expect(surface('baket', ['PRF', 'AF'], [0, 1]).satisfied).toEqual([true, true])
    // 後綴 -un 加在 pa- 之後：只讀詞根
    expect(surface('bitud', ['CAUS', 'PF'], [0, 1]).satisfied).toEqual([true, true])
  })
})

describe('編譯成 BCDP 的平面結構', () => {
  const c = compileGrammar(g)

  it('自由的同位詞素：一個一項，帶 parts 與搜尋時才能決定的條件', () => {
    const m = c.prefixes.find((p) => p.form === 'm')
    expect(m?.parts).toEqual([{ id: 'AF', type: 'prefix', form: 'm', gloss: GRAMMAR.morphemes[0].gloss }])
    expect(m?.checks?.start.map((k) => k.cond.source)).toEqual(['^V'])
    expect(c.suffixes.find((s) => s.form === 'un')?.checks?.end.map((k) => k.cond.source)).toEqual(['uC*$'])
    expect(c.suffixes.find((s) => s.form === 'en')?.checks).toBeUndefined()
  })

  it('落在前綴上的中綴：複合前綴，成本加 unattestedPenalty；只有輔音的前綴要求詞根元音開頭（硬性）', () => {
    const ma = c.prefixes.find((p) => p.form === 'ma' && p.parts?.length === 2)
    expect(ma?.parts?.map((p) => `${p.id}:${p.form}`)).toEqual(['AF:m', 'PROG:a'])
    expect(ma?.cost).toBeCloseTo(0.2 + 0.2 + 0.2)
    expect(ma?.checks?.start.map((k) => [k.cond.source, k.penalty])).toEqual([['^V', 0.3], ['^V', Infinity]])
    const mau = c.prefixes.find((p) => p.form === 'mau')
    expect(mau?.parts?.map((p) => p.form)).toEqual(['mu', 'a'])
    expect(mau?.checks?.start.map((k) => k.cond.source)).toEqual(['^C+[ua]'])
    expect(c.prefixes.find((p) => p.form === 'pina')?.parts?.map((p) => p.id)).toEqual(['CAUS', 'PRF'])
  })

  it('組合規則：每種同位詞素一項；只有前綴的組合規則右邊是空字串', () => {
    const irr = c.circumfixes.filter((x) => x.construction?.id === 'AF.IRR')
    expect(irr.map((x) => `${x.kind}:${x.left}…${x.suffix}`)).toEqual(['prefix:ma…ay', 'prefix:mau…ay', 'prefix:mai…ay', 'prefix:mae…ay'])
    expect(irr[0].cost).toBe(0.2)
    expect(irr[0].parts?.map((p) => p.id)).toEqual(['AF', 'PROG', 'IRR'])
    const prf = c.circumfixes.filter((x) => x.construction?.id === 'AF.PRF')
    expect(prf.map((x) => `${x.left}|${x.suffix}`)).toEqual(['min|', 'minu|', 'mini|', 'mine|'])
    expect(c.circumfixes.find((x) => x.construction?.id === 'LF.PRF')).toMatchObject({ kind: 'infix', left: 'in', suffix: 'an' })
  })

  it('編譯結果與推導產生器一致（組合規則的每一種選擇 × 幾個詞根）', () => {
    for (const x of c.circumfixes.filter((e) => e.kind === 'prefix')) {
      const cons = GRAMMAR.constructions.find((k) => k.id === x.construction?.id)
      const members = /** @type {string[]} */ (cons?.sequence)
      const choice = /** @type {any[]} */ (x.parts).map((p, k) => g.byId.get(members[k])?.allomorphs.findIndex((a) => a.form === p.form))
      for (const root of ['usa', 'baket', 'kita']) {
        const needsVowel = x.checks?.start.some((k) => k.penalty === Infinity)
        if (needsVowel && !'aeiou'.includes(root[0])) continue
        const d = derive(g, root, members.map((id, k) => ({ id, allomorph: choice[k] })))
        expect(d.surface, `${x.construction?.id} ${root}`).toBe(x.left + root + x.suffix)
      }
    }
  })

  it('條件的部分求值：已知的部分讀完就決定，決定不了的留到搜尋時', () => {
    // 同一個 DFA 由 start 讀 'u' 就接受：m- 的 ^V 對 usa 成立
    const m = /** @type {any} */ (c.prefixes.find((p) => p.form === 'm')).checks.start[0]
    expect(m.cond.status(m.cond.step(m.state, 'u'))).toBe(ACCEPT)
  })
})

describe('以文法搜尋（BCDP）', () => {
  /** @param {string} localId @param {string} text */
  const rec = (localId, text) => createRecord({ source: 'dict', localId, unit: 'word', text, citation: createCitation(`dict ${localId}`) }, { senses: [createSense({ zh: text })] })
  const records = ['usa', 'udan', 'baket', 'kita'].map((w) => rec(w, w))
  const built = buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: GRAMMAR } })
  const engine = new SearchEngine(JSON.parse(JSON.stringify(built)))
  const analysisOf = (/** @type {string} */ q, /** @type {string} */ id) => engine.search(q, { fields: ['native'] }).entries.find((h) => h.doc.id === id)?.analysis

  it('mausay → usa：組合規則 AF.IRR（m- ＋ <a> ＋ -ay），底層 a｜a 由 aa → a', () => {
    const a = analysisOf('mausay', 'dict:usa')
    expect(a?.steps).toEqual([expect.objectContaining({ type: 'circumfix', construction: expect.objectContaining({ id: 'AF.IRR' }) })])
    expect(a?.steps[0].parts?.map((p) => `${p.id}:${p.form}`)).toEqual(['AF:m', 'PROG:a', 'IRR:ay'])
  })

  it('maudanay → udan；minubaket → baket（AF.PRF）', () => {
    expect(analysisOf('maudanay', 'dict:udan')?.steps[0].construction?.id).toBe('AF.IRR')
    expect(analysisOf('minubaket', 'dict:baket')?.steps.map((s) => s.construction?.id ?? s.type)).toEqual(['AF.PRF'])
  })

  it('binaket → baket：詞根上的中綴；mubinaket → baket：<in> 之後再加 mu-（未收錄的順序，兩個自由步驟）', () => {
    expect(analysisOf('binaket', 'dict:baket')?.steps.map((s) => `${s.type}:${s.form}`)).toEqual(['infix:in'])
    const a = analysisOf('mubinaket', 'dict:baket')
    expect(a?.steps.map((s) => `${s.type}:${s.form}`)).toEqual(['prefix:mu', 'infix:in'])
    expect(a?.cost).toBeCloseTo(0.4)
  })

  it('同位詞素的條件：mi- 接第一個元音是 a 的詞根不成立，要付懲罰（詞根方向）', () => {
    // mubaket 的 mu- 條件成立；mibaket 的 mi- 條件（^C+i）不成立：同一個詞根，成本多 conditionPenalty
    const mu = engine.search('mubaket', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:baket')?.analysis
    const mi = engine.search('mibaket', { fields: ['native'] }).entries.find((h) => h.doc.id === 'dict:baket')?.analysis
    expect(mu?.penalty).toBeUndefined()
    expect(mi?.penalty).toBeCloseTo(0.3)
    expect(/** @type {number} */ (mi?.cost) - /** @type {number} */ (mu?.cost)).toBeCloseTo(0.3)
  })

  it('同位詞素的條件（衍生形方向）：查 baket，mubaket 不付懲罰、mibaket 付', () => {
    const recs = ['baket', 'mubaket', 'mibaket'].map((w) => rec(w, w))
    const b = buildSearchIndex({ items: recs.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: GRAMMAR } })
    const e = new SearchEngine(JSON.parse(JSON.stringify(b)))
    const entries = e.search('baket', { fields: ['native'] }).entries
    const mu = entries.find((h) => h.doc.id === 'dict:mubaket')
    const mi = entries.find((h) => h.doc.id === 'dict:mibaket')
    expect(mu).toMatchObject({ matchType: 'derived' })
    expect(mu?.analysis?.penalty).toBeUndefined()
    expect(mi?.analysis?.penalty).toBeCloseTo(0.3)
  })

  it('實驗室的說明可以結構化複製（條件的 DFA 是函式，不能出現在回傳值裡）', () => {
    const x = engine.explainMorphology('mausay', 'usa')
    expect(structuredClone(x)).toEqual(x)
  })

  it('分析器（去詞綴）也看得懂文法', () => {
    const analyzer = createAnalyzer(GRAMMAR)
    const stems = analyzer.analyze('minubaket').map((x) => `${x.stem}:${x.steps.map((s) => s.construction?.id ?? s.type).join('+')}`)
    expect(stems).toContain('baket:AF.PRF')
  })
})
