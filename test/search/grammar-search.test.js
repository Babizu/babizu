/**
 * 以構詞文法搜尋（搜尋引擎的整合測試）：構詞文法展開後的規格交給原本的 BCDP，包覆單位與組合規則照樣找得到。
 * 文法本身的檢查、展開與引理在 BCDP 套件的 packages/bcdp/test/grammar.test.js。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.ts'
import { SearchEngine, buildDerivationGraph, buildSearchIndex } from '../../src/search/index.ts'
import { PAZEH_PROFILE } from '../../packages/bcdp/test/fixtures/pazeh.js'
import { GRAMMAR } from '../../packages/bcdp/test/fixtures/grammar.js'

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
