/**
 * 檢查清單（src/search/checklist.js）：例句中沒有辭典條目的詞、完全相同的詞條。
 * 資料是合成的：一部辭典（dict）、一份詞表（list）、一份語料（corpus，只提供例句）。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.js'
import { Checklist, classify, SearchEngine, buildSearchIndex } from '../../src/search/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

/**
 * @param {string} source
 * @param {string} localId
 * @param {string} text
 * @param {{unit?: string, zh?: string}} [o]
 */
const rec = (source, localId, text, o = {}) =>
  createRecord(
    { source, localId, unit: /** @type {any} */ (o.unit ?? 'word'), text, citation: createCitation(`${source} ${localId}`) },
    { senses: o.zh === '' ? [] : [createSense({ zh: o.zh ?? text })] },
  )

const records = [
  rec('dict', 'baket-1', 'baket', { zh: '打' }),
  rec('dict', 'baket-2', 'baket', { zh: '打' }), // 同一部辭典登錄兩次，釋義也相同
  rec('dict', 'lalan', 'lalan', { zh: '路' }),
  rec('dict', 'daux', 'daux', { zh: '去' }),
  rec('dict', 'kita', 'kita', { zh: '看' }),
  rec('list', 'kita', 'kita', { zh: '看見' }), // 跨來源，釋義不同
  rec('list', 'saw', 'saw', { zh: '' }),
  rec('list', 'saw-2', 'saw', { zh: '' }), // 同一來源重複，但沒有釋義：無從判斷是不是重複登錄
  rec('corpus', 's1', 'ralan mubaket , kita.', { unit: 'sentence', zh: '句一' }),
  rec('corpus', 's2', 'ralan zzzqqq', { unit: 'sentence', zh: '句二' }),
  rec('corpus', 's3', 'mubaket daux', { unit: 'sentence', zh: '句三' }),
  rec('corpus', 'w1', 'ralan', { zh: '語料中的詞' }), // 語料來源的詞不算辭典條目
  rec('corpus', 's4', 'mubaket  daux', { unit: 'sentence', zh: '句三' }), // 與 s3 只差空白、翻譯相同：重複收錄
  rec('dict', 'x1', 'ralan zzzqqq', { unit: 'sentence', zh: '辭典的例句' }), // 與 s2 相同，但在另一個來源
]

const profile = { ...PAZEH_PROFILE, morphology: { prefixes: [{ form: 'mu', gloss: 'AF' }] } }
const built = buildSearchIndex({ items: records.map((record) => ({ record, shard: 'a' })), groups: [], sourceIds: ['dict', 'list', 'corpus'], profile })
const engine = new SearchEngine(JSON.parse(JSON.stringify(built)))
const checklist = new Checklist(engine, ['dict', 'list'])

describe('例句中沒有辭典條目的詞', () => {
  it('只列沒有辭典條目的詞（語料中的詞不算條目、標點不算詞），依出現次數再依詞排序', () => {
    expect(checklist.untreatedTokens().map((t) => [t.term, t.count])).toEqual([
      ['mubaket', 3],
      ['ralan', 3],
      ['zzzqqq', 2],
    ])
  })

  it('依最接近的詞條猜類別：只差方言規則的是方言變體、拆得出詞根的是加綴派生、找不到的是沒有相近的詞條', () => {
    expect(checklist.candidates('ralan').kind).toBe('variant')
    expect(checklist.candidates('ralan').hits[0].doc.text).toBe('lalan')
    expect(checklist.candidates('mubaket').kind).toBe('derivation')
    expect(checklist.candidates('zzzqqq')).toEqual({ kind: 'none', hits: [] })
  })

  it('分頁：篩選類別時只比對到湊滿一頁為止，並回報比對進度', () => {
    const first = checklist.tokenPage({ limit: 2 })
    expect(first.items.map((t) => t.term)).toEqual(['mubaket', 'ralan'])
    expect(first.items[0].examples.map((d) => d.id)).toEqual(['corpus:s1', 'corpus:s3'])
    expect(first.hasMore).toBe(true)
    const rest = checklist.tokenPage({ offset: 2, limit: 2 })
    expect(rest.items.map((t) => t.term)).toEqual(['zzzqqq'])
    expect(rest.hasMore).toBe(false)
    expect(checklist.tokenPage({ kind: 'variant' }).items.map((t) => t.term)).toEqual(['ralan'])
    expect(checklist.tokenPage({ sort: 'text', limit: 1 }).items[0].term).toBe('mubaket')
    expect(checklist.progress()).toEqual({ analyzed: 3, counts: { variant: 1, derivation: 1, near: 0, none: 1 } })
  })
})

describe('完全相同的詞條', () => {
  it('辭典來源中詞形完全相同的記錄成組；同一來源內釋義也相同的標為疑似重複登錄', () => {
    const groups = checklist.duplicateGroups().map((g) => ({ text: g.text, n: g.docs.length, sameSource: g.sameSource, crossSource: g.crossSource, repeated: g.repeated }))
    expect(groups).toEqual([
      { text: 'baket', n: 2, sameSource: true, crossSource: false, repeated: true },
      { text: 'kita', n: 2, sameSource: false, crossSource: true, repeated: false },
      { text: 'saw', n: 2, sameSource: true, crossSource: false, repeated: false },
    ])
    const page = checklist.duplicatePage({ filter: 'repeated' })
    expect(page.total).toBe(1)
    expect(page.counts).toEqual({ all: 3, sameSource: 2, crossSource: 1, repeated: 1 })
    expect(page.items[0].docs.map((d) => d.id)).toEqual(['dict:baket-1', 'dict:baket-2'])
  })

  it('統計', () => {
    expect(checklist.summary()).toEqual({ entries: 8, sentences: 5, tokens: 5, untreated: 3, duplicates: 3, duplicateSentences: 2 })
  })
})

describe('重複的例句', () => {
  it('所有來源中句子相同的記錄成組（連續的空白視為一個）；同一來源內翻譯也相同的標為疑似重複登錄', () => {
    const groups = checklist.duplicateSentences().map((g) => ({ text: g.text, ids: g.docs.map((k) => engine.docs.id[k]), crossSource: g.crossSource, repeated: g.repeated }))
    expect(groups).toEqual([
      { text: 'mubaket daux', ids: ['corpus:s3', 'corpus:s4'], crossSource: false, repeated: true },
      { text: 'ralan zzzqqq', ids: ['corpus:s2', 'dict:x1'], crossSource: true, repeated: false },
    ])
    expect(checklist.sentencePage({ filter: 'crossSource' }).items.map((g) => g.text)).toEqual(['ralan zzzqqq'])
  })
})

describe('classify', () => {
  const hit = (/** @type {any} */ o) => ({ score: 0.1, matchType: 'fuzzy', alignment: [{ op: 'rule' }], ...o })
  it('同分的幾筆一起看：有構詞分析優先，其次只靠規則的模糊命中', () => {
    expect(classify([])).toBe('none')
    expect(classify([hit({ alignment: [{ op: 'substitute' }] }), hit({})])).toBe('variant')
    expect(classify([hit({}), hit({ matchType: 'lemma', alignment: null })])).toBe('derivation')
    expect(classify([hit({ alignment: [{ op: 'substitute' }] }), hit({ score: 0.5 })])).toBe('near')
  })
})
