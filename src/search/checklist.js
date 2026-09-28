/**
 * @file 檢查清單：給校對者的資料檢查（網站的 /checklist 頁，由資料來源頁連入）。
 *
 * 兩份清單，都直接由已載入的搜尋索引算出，不需要另外的資料檔：
 *
 * 1. **例句中沒有詞條的詞**：例句、片語裡出現的詞（搜尋鍵），沒有任何辭典來源（type 不是 corpus 的來源）
 *    以它為詞形、其他寫法或變體建立條目。每個詞再用辭典做一次模糊搜尋，列出最接近的詞條，並依最接近的那一筆
 *    猜它是什麼：像方言變體（只靠方言規則就對得上）、像加綴派生（構詞分析找到詞根）、有相近的詞條、沒有相近的詞條。
 *    模糊搜尋比較花時間，只在要顯示（或依類別篩選）時才做，結果快取。
 * 2. **完全相同的詞條**：辭典來源中詞形（原始寫法，只做 Unicode 正規化與去頭尾空白）完全相同的記錄，放在一起看。
 *    標出同一個來源內重複、跨來源，以及同一個來源內釋義也相同（最可能是重複登錄）。
 * 3. **重複的例句**：所有來源（含語料）中句子完全相同的記錄（連續的空白視為一個），標記方式同上：
 *    同一個來源內翻譯也相同的最可能是重複收錄。
 */

import { decodePosting, docAt } from './format.js'

/** @typedef {import('./engine.js').SearchEngine} SearchEngine */
/** @typedef {import('./format.js').DocSummary} DocSummary */
/** @typedef {import('./engine.js').EntryHit} EntryHit */

/** 由辭典建立條目的比對身分：詞形、其他寫法、變體 */
const ENTRY_KINDS = new Set(['head', 'alt', 'variant'])
/** 拼寫相近或拆解得出的命中（用來猜這個詞是什麼）；開頭相符、包含不算 */
const SIMILAR = new Set(['fuzzy', 'lemma', 'derived'])
/** 至少含一個字母或數字才算詞（切詞留下的標點、符號不列） */
const WORDLIKE = /[\p{L}\p{N}]/u

/**
 * @typedef {'variant' | 'derivation' | 'near' | 'none'} TokenKind
 *   variant 像方言變體；derivation 像加綴派生；near 有相近的詞條；none 沒有相近的詞條
 */

/**
 * @typedef {object} UntreatedToken
 * @property {string} term 詞（搜尋鍵）
 * @property {number} count 出現在幾筆例句、片語中
 * @property {number[]} docs 那些記錄（依索引順序）
 */

/**
 * @typedef {object} DuplicateGroup
 * @property {string} text 詞形
 * @property {number[]} docs 記錄
 * @property {number} sources 分屬幾個來源
 * @property {boolean} sameSource 同一個來源內有重複
 * @property {boolean} crossSource 跨來源
 * @property {boolean} repeated 同一個來源內有兩筆的釋義（例句是翻譯）也完全相同（最可能是重複登錄）
 */

/**
 * @typedef {{filter?: 'all' | 'repeated' | 'sameSource' | 'crossSource', offset?: number, limit?: number}} GroupPageOptions
 */

/**
 * 一個搜尋引擎、一組辭典來源的檢查清單（計算結果快取在物件上）。
 */
export class Checklist {
  /**
   * @param {SearchEngine} engine
   * @param {string[]} lexicalSources 辭典來源（會建立條目的來源；語料不算）
   */
  constructor(engine, lexicalSources) {
    this.engine = engine
    this.lexicalSources = [...lexicalSources]
    const docs = engine.docs
    const lexical = new Set(lexicalSources.map((id) => docs.sources.indexOf(id)).filter((k) => k >= 0))
    /** @param {number} k */
    this._isLexical = (k) => lexical.has(docs.source[k])
    /** @type {UntreatedToken[] | null} */
    this._tokens = null
    /** @type {DuplicateGroup[] | null} */
    this._duplicates = null
    /** @type {DuplicateGroup[] | null} */
    this._sentences = null
    /** @type {Map<string, {kind: TokenKind, hits: EntryHit[]}>} */
    this._candidates = new Map()
  }

  /** 例句、片語中出現、但沒有辭典條目的詞，依出現次數（多的在前）、再依詞排序 */
  untreatedTokens() {
    if (this._tokens) return this._tokens
    const { index } = this.engine
    /** @type {UntreatedToken[]} */
    const out = []
    for (const term of index.terms) {
      if (!WORDLIKE.test(term)) continue
      /** @type {number[]} */
      const docs = []
      let hasEntry = false
      for (const code of index.lookup(term) ?? []) {
        const { doc, kind } = decodePosting(/** @type {number} */ (code))
        if (kind === 'token') docs.push(doc)
        else if (ENTRY_KINDS.has(kind) && this._isLexical(doc)) hasEntry = true
      }
      if (docs.length && !hasEntry) out.push({ term, count: new Set(docs).size, docs: [...new Set(docs)] })
    }
    out.sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    return (this._tokens = out)
  }

  /** 例句、片語中出現的不同的詞（有辭典條目的也算） */
  tokenCount() {
    const { index } = this.engine
    let n = 0
    for (const term of index.terms) {
      if (!WORDLIKE.test(term)) continue
      if ((index.lookup(term) ?? []).some((c) => decodePosting(/** @type {number} */ (c)).kind === 'token')) n++
    }
    return n
  }

  /**
   * 一個詞在辭典中最接近的詞條，以及依最接近的那一筆猜它是什麼（結果快取）。
   * @param {string} term
   * @param {number} [limit=3]
   * @returns {{kind: TokenKind, hits: EntryHit[]}}
   */
  candidates(term, limit = 3) {
    const cached = this._candidates.get(term)
    if (cached) return cached
    const response = this.engine.search(term, {
      fields: ['native'],
      filters: { sources: this.lexicalSources },
      limit: 20,
      explainLimit: limit,
    })
    // 模糊與構詞命中（拼寫相近、拆解得出）排在前面；開頭相符、包含（這個詞只是某個片語的一部分）排在後面
    const entries = response.entries.filter((h) => h.doc.unit !== 'sentence')
    const near = entries.filter((h) => SIMILAR.has(h.matchType))
    const hits = [...near, ...entries.filter((h) => !SIMILAR.has(h.matchType))].slice(0, limit)
    const result = { kind: classify(near), hits }
    this._candidates.set(term, result)
    return result
  }

  /**
   * 一頁「沒有詞條的詞」：依類別篩選時，只比對到湊滿這一頁為止。
   * @param {{kind?: TokenKind | 'all', sort?: 'count' | 'text', offset?: number, limit?: number}} [options]
   */
  tokenPage({ kind = 'all', sort = 'count', offset = 0, limit = 30 } = {}) {
    const all = this.untreatedTokens()
    const list = sort === 'text' ? [...all].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0)) : all
    const items = []
    let matched = 0
    let k = 0
    for (; k < list.length && items.length < limit; k++) {
      const token = list[k]
      const found = this.candidates(token.term)
      if (kind !== 'all' && found.kind !== kind) continue
      if (matched++ < offset) continue
      items.push({
        term: token.term,
        count: token.count,
        examples: token.docs.slice(0, 2).map((d) => docAt(this.engine.docs, d)),
        kind: found.kind,
        hits: found.hits,
      })
    }
    // 還沒比對過的詞還可能有符合的：篩選時，後面是否還有要等比對完才知道
    const hasMore = kind === 'all' ? offset + items.length < list.length : k < list.length
    return { items, hasMore, total: list.length, ...this.progress() }
  }

  /** 已比對的詞數與各類別的數量（只算已比對的） */
  progress() {
    /** @type {Record<TokenKind, number>} */
    const counts = { variant: 0, derivation: 0, near: 0, none: 0 }
    for (const found of this._candidates.values()) counts[found.kind]++
    return { analyzed: this._candidates.size, counts }
  }

  /** 辭典來源中詞形（原始寫法）完全相同的記錄，依詞形排序 */
  duplicateGroups() {
    const docs = this.engine.docs
    return (this._duplicates ??= groupByText(
      docs,
      (k) => this._isLexical(k) && docAt(docs, k).unit !== 'sentence',
      (text) => text.normalize('NFC').trim(),
    ))
  }

  /** 所有來源（含語料）中句子完全相同的記錄（連續的空白視為一個），依句子排序 */
  duplicateSentences() {
    const docs = this.engine.docs
    return (this._sentences ??= groupByText(
      docs,
      (k) => docAt(docs, k).unit === 'sentence',
      (text) => text.normalize('NFC').replace(/\s+/gu, ' ').trim(),
    ))
  }

  /**
   * 一頁「完全相同的詞條」。
   * @param {GroupPageOptions} [options]
   */
  duplicatePage(options = {}) {
    return this._groupPage(this.duplicateGroups(), options)
  }

  /**
   * 一頁「重複的例句」。
   * @param {GroupPageOptions} [options]
   */
  sentencePage(options = {}) {
    return this._groupPage(this.duplicateSentences(), options)
  }

  /**
   * @param {DuplicateGroup[]} all
   * @param {GroupPageOptions} options
   */
  _groupPage(all, { filter = 'all', offset = 0, limit = 30 }) {
    const list = filter === 'all' ? all : all.filter((g) => g[filter])
    const docs = this.engine.docs
    return {
      total: list.length,
      counts: {
        all: all.length,
        sameSource: all.filter((g) => g.sameSource).length,
        crossSource: all.filter((g) => g.crossSource).length,
        repeated: all.filter((g) => g.repeated).length,
      },
      items: list.slice(offset, offset + limit).map((g) => ({ ...g, docs: g.docs.map((k) => docAt(docs, k)) })),
    }
  }

  /** 頁首的統計 */
  summary() {
    const docs = this.engine.docs
    let entries = 0
    let sentences = 0
    for (let k = 0; k < docs.id.length; k++) {
      const unit = docAt(docs, k).unit
      if (unit === 'sentence') sentences++
      else if (this._isLexical(k)) entries++
    }
    return {
      entries,
      sentences,
      tokens: this.tokenCount(),
      untreated: this.untreatedTokens().length,
      duplicates: this.duplicateGroups().length,
      duplicateSentences: this.duplicateSentences().length,
    }
  }
}

/**
 * 文字相同的記錄成組（至少兩筆），依文字排序。
 * @param {import('./format.js').SearchDocs} docs
 * @param {(k: number) => boolean} accept 要比對的記錄
 * @param {(text: string) => string} normalize 比對用的寫法
 * @returns {DuplicateGroup[]}
 */
function groupByText(docs, accept, normalize) {
  /** @type {Map<string, number[]>} */
  const byText = new Map()
  for (let k = 0; k < docs.id.length; k++) {
    if (!accept(k)) continue
    const text = normalize(docs.text[k])
    if (!text) continue
    const list = byText.get(text)
    if (list) list.push(k)
    else byText.set(text, [k])
  }
  /** @type {DuplicateGroup[]} */
  const out = []
  for (const [text, ks] of byText) {
    if (ks.length < 2) continue
    const sources = new Set(ks.map((k) => docs.source[k]))
    // 同一個來源、釋義也相同（沒有釋義的不算：只有詞形的詞表無從判斷）
    const keyed = ks.filter((k) => docs.zh[k] || docs.en[k]).map((k) => `${docs.source[k]}\u0000${docs.zh[k]}\u0000${docs.en[k]}`)
    out.push({
      text,
      docs: ks,
      sources: sources.size,
      sameSource: sources.size < ks.length,
      crossSource: sources.size > 1,
      repeated: new Set(keyed).size < keyed.length,
    })
  }
  return out.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
}

/**
 * 依最接近的詞條猜這個詞是什麼：看成本最低的那幾筆（同分的都看）。有構詞分析的算加綴派生，
 * 只靠方言規則對得上的算方言變體，其他的只是拼寫相近。
 * @param {EntryHit[]} hits 模糊與構詞命中，依排序分數排好
 * @returns {TokenKind}
 */
export function classify(hits) {
  if (!hits.length) return 'none'
  const best = hits.filter((h) => h.score <= hits[0].score + 1e-9)
  if (best.some((h) => h.matchType === 'lemma')) return 'derivation'
  if (best.some((h) => h.matchType === 'fuzzy' && h.alignment?.length && h.alignment.every((n) => n.op === 'rule'))) return 'variant'
  return 'near'
}
