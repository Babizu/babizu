/**
 * @file 釋義搜尋：中文（「單字 → 記錄」反向索引）與英文、臺語羅馬字（「詞 → 記錄」反向索引）。
 *
 * 兩個索引都在第一次用到時才建立（warmup 可以預先建立）。
 */

import type { DocSummary, SearchDocs } from './format.ts'
import { ROLE_RANK, UNKNOWN_ROLE_RANK } from './scoring.ts'
import { glossTokens, zhNormalize } from './text.ts'
import type { GlossHit } from './types.ts'

/** 英文釋義搜尋忽略的虛詞 */
const GLOSS_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'is', 'be', 'and', 'or', 'for', 'with'])

/** 英文查詢詞至少要這麼長才做詞首比對（較短的只比整詞，避免 `ca` 配到上百個詞） */
const GLOSS_PREFIX_MIN_LENGTH = 3

/** 拉丁字母釋義的欄位 */
type LatinField = 'en' | 'nan'

export class GlossSearch {
  private readonly docs: SearchDocs
  private readonly doc: (k: number) => DocSummary
  private _zhIndex: Map<string, number[]> | null = null
  private _latinIndex: { tokens: Map<string, Array<[number, LatinField]>>; sorted: string[] } | null = null

  /** @param doc 記錄編號 → 摘要（搜尋引擎的 doc） */
  constructor(docs: SearchDocs, doc: (k: number) => DocSummary) {
    this.docs = docs
    this.doc = doc
  }

  /** 預先建立兩個索引，讓第一次查詢不必等待。 */
  warmup(): void {
    this.zhIndex()
    this.latinIndex()
  }

  /** 中文釋義搜尋：取查詢中各漢字 posting 的交集，再驗證整個查詢是子字串。 */
  searchZh(q: string, accept: (k: number) => boolean): GlossHit[] {
    const needle = zhNormalize(q)
    if (!needle) return []
    const index = this.zhIndex()

    // 取所有漢字 posting 的交集，從最短的開始
    const chars = [...new Set(Array.from(needle).filter((ch) => /\p{Script=Han}/u.test(ch)))]
    const lists = chars.map((ch) => index.get(ch) ?? [])
    lists.sort((a, b) => a.length - b.length)
    let candidates = lists.length > 0 ? lists[0] : this.docs.zh.map((_, k) => k)
    for (const list of lists.slice(1)) {
      const set = new Set(list)
      candidates = candidates.filter((k) => set.has(k))
      if (candidates.length === 0) break
    }

    const hits: GlossHit[] = []
    for (const k of candidates) {
      if (!accept(k)) continue
      const zh = zhNormalize(this.docs.zh[k])
      if (!zh.includes(needle)) continue
      hits.push({ doc: this.doc(k), field: 'zh', rank: glossRank(zh.split(/[；;，,、]/u), needle) })
    }
    return sortGlossHits(hits)
  }

  /** 英文與臺語羅馬字釋義搜尋：每個查詢詞都要命中（整詞，或夠長時的詞首）。 */
  searchLatin(q: string, accept: (k: number) => boolean): GlossHit[] {
    // 去掉英文虛詞；全部都是虛詞（例如單查 a）時不搜尋釋義，避免列出上千筆無意義結果
    const queryTokens = glossTokens(q).filter((t) => !GLOSS_STOPWORDS.has(t))
    if (queryTokens.length === 0) return []
    const { tokens, sorted } = this.latinIndex()

    let combined: Map<number, LatinField> | null = null
    for (const qt of queryTokens) {
      const found = new Map<number, LatinField>()
      const matching = Array.from(qt).length >= GLOSS_PREFIX_MIN_LENGTH ? prefixRange(sorted, qt) : tokens.has(qt) ? [qt] : []
      for (const token of matching) {
        // 同一筆記錄兩個欄位都命中時記英文
        for (const [k, field] of tokens.get(token) ?? []) {
          if (!found.has(k) || field === 'en') found.set(k, field)
        }
      }
      if (combined === null) combined = found
      else {
        const next = new Map<number, LatinField>()
        for (const [k, field] of combined) if (found.has(k)) next.set(k, field)
        combined = next
      }
      if (combined.size === 0) break
    }

    const phrase = queryTokens.join(' ')
    const hits: GlossHit[] = []
    for (const [k, field] of combined ?? new Map<number, LatinField>()) {
      if (!accept(k)) continue
      const text = this.docs[field][k]
      const senses = text.split(/[;；]/u).map((s) => glossTokens(s).join(' '))
      hits.push({ doc: this.doc(k), field, rank: glossRank(senses, phrase, true) })
    }
    return sortGlossHits(hits)
  }

  /** 漢字 → 釋義含有它的記錄（遞增） */
  private zhIndex(): Map<string, number[]> {
    if (this._zhIndex) return this._zhIndex
    const index = new Map<string, number[]>()
    this.docs.zh.forEach((zh, k) => {
      for (const ch of new Set(Array.from(zh))) {
        if (!/\p{Script=Han}/u.test(ch)) continue
        let list = index.get(ch)
        if (!list) index.set(ch, (list = []))
        list.push(k)
      }
    })
    this._zhIndex = index
    return index
  }

  /** 詞 → [記錄, 欄位]，另保留排序後的詞表以支援詞首查詢 */
  private latinIndex() {
    if (this._latinIndex) return this._latinIndex
    const tokens = new Map<string, Array<[number, LatinField]>>()
    for (const field of ['en', 'nan'] as const) {
      this.docs[field].forEach((text, k) => {
        for (const token of glossTokens(text)) {
          let list = tokens.get(token)
          if (!list) tokens.set(token, (list = []))
          list.push([k, field])
        }
      })
    }
    this._latinIndex = { tokens, sorted: [...tokens.keys()].sort() }
    return this._latinIndex
  }
}

function sortGlossHits(hits: GlossHit[]): GlossHit[] {
  return hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      (ROLE_RANK[a.doc.role] ?? UNKNOWN_ROLE_RANK) - (ROLE_RANK[b.doc.role] ?? UNKNOWN_ROLE_RANK) ||
      a.doc[a.field].length - b.doc[b.field].length ||
      a.doc.index - b.doc.index,
  )
}

/**
 * 釋義命中等級：0 某義項完全相同、1 某義項以查詢開頭（英文另接受 "to " 開頭）、2 整詞包含、3 其他。
 * @param senses 已正規化的各義項
 * @param needle 已正規化的查詢
 * @param latin 是否以空白分詞比對
 */
function glossRank(senses: string[], needle: string, latin = false): number {
  const trimmed = senses.map((s) => s.trim())
  if (trimmed.some((s) => s === needle || (latin && s === `to ${needle}`))) return 0
  if (trimmed.some((s) => s.startsWith(needle) || (latin && s.startsWith(`to ${needle}`)))) return 1
  if (latin && trimmed.some((s) => ` ${s} `.includes(` ${needle} `))) return 2
  return 3
}

/** 在排序過的詞表中找出所有以 prefix 開頭的詞（二分搜尋）。 */
function prefixRange(sorted: string[], prefix: string): string[] {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < prefix) lo = mid + 1
    else hi = mid
  }
  const out = []
  for (let k = lo; k < sorted.length && sorted[k].startsWith(prefix); k++) out.push(sorted[k])
  return out
}
