/**
 * @file 搜尋引擎中的對應組檢索（實驗性；docs/csr.md）：詞條改由對應組檢索比對，例句與釋義照舊。
 *
 * 詞庫的「詞」取自詞圖：每個不含空白的詞（搜尋鍵），落在單位為 word 的記錄上、身分是詞形、其他寫法或變體的，
 * 依記錄的方言分成（詞, 方言）——記錄的方言代碼對到模型的方言（下層變體算上層的，例如愛蘭算巴宰），
 * 沒有方言標記的依模型的 sourceDialects 由來源推定，都推不出來的是方言未知。
 */

import { CorrespondenceSearch, type CsrEntry, type CsrFuzziness, type CsrModel } from './csr/index.ts'
import { groupEntries } from './entry-search.ts'
import { collectHits } from './family.ts'
import { decodeDialects, decodePosting, type DocSummary, type MatchKind, type SearchDocs } from './format.ts'
import { compareHits } from './scoring.ts'
import type { TextTools } from './text.ts'
import type { EntryHit, SearchResponse } from './types.ts'
import type { FuzzyIndex, LanguageProfile } from '#bcdp'

/** 一個（詞, 方言）落在哪些記錄上 */
interface Posting {
  doc: number
  kind: MatchKind
}

const LEXICAL_KINDS = new Set<MatchKind>(['head', 'alt', 'variant'])

/** 對應組檢索與它的詞庫（第一次用到時由詞圖與記錄摘要建立） */
export interface CorrespondenceIndex {
  search: CorrespondenceSearch
  postings: Posting[][]
}

export function buildCorrespondenceIndex(model: CsrModel, profile: LanguageProfile, docs: SearchDocs, index: FuzzyIndex): CorrespondenceIndex {
  const dialectOf = (k: number): string | null => {
    const codes = decodeDialects(docs.dialect[k], docs.dialects)
    if (codes.length === 0) return model.sourceDialects?.[docs.sources[docs.source[k]]] ?? null
    for (const c of codes) {
      const d = model.dialects.find((m) => m === c || (docs.dialectSupersets[m] ?? []).includes(c))
      if (d) return d
    }
    return null
  }
  const entries: CsrEntry[] = []
  const postings: Posting[][] = []
  const terms = index.terms
  const payloads = index.payloads
  terms.forEach((term, id) => {
    if (!term || /\s/u.test(term)) return
    const byDialect = new Map<string | null, Posting[]>()
    for (const code of (payloads[id] ?? []) as number[]) {
      const { doc, kind } = decodePosting(code)
      if (!LEXICAL_KINDS.has(kind) || docs.units[docs.unit[doc]] !== 'word') continue
      const d = dialectOf(doc)
      let list = byDialect.get(d)
      if (!list) byDialect.set(d, (list = []))
      list.push({ doc, kind })
    }
    for (const [dialect, list] of byDialect) {
      entries.push({ key: term, dialect })
      postings.push(list)
    }
  })
  return { search: new CorrespondenceSearch({ model, profile, entries }), postings }
}

/** 對應組檢索需要的搜尋引擎部分 */
export interface CsrContext {
  readonly correspondence: CorrespondenceIndex | null
  readonly text: Pick<TextTools, 'searchKey'>
  readonly docs: Pick<SearchDocs, 'parent'>
  childrenOf: (k: number) => readonly number[]
  doc(k: number): DocSummary
}

/**
 * 以對應組檢索取代 response 的詞條（entries、entryGroups、terms）。
 * @returns 有沒有做（沒有模型、或查詢含空白時不做，詞條保留原本的方法）
 */
export function searchCorrespondence(ctx: CsrContext, q: string, response: SearchResponse, { fuzziness, accept, explainLimit }: { fuzziness: CsrFuzziness; accept: (k: number) => boolean; explainLimit: number }): boolean {
  const index = ctx.correspondence
  const key = ctx.text.searchKey(q)
  if (!index || !key || /\s/u.test(key)) return false
  const { search, postings } = index
  const hits = search.search(key, { fuzziness, accept: (e) => postings[e].some((p) => accept(p.doc)) })
  const best = new Map<number, { hit: EntryHit; source: (typeof hits)[number] }>()
  for (const h of hits) {
    for (const p of postings[h.entry]) {
      if (!accept(p.doc)) continue
      const hit: EntryHit = {
        doc: ctx.doc(p.doc),
        term: search.entries[h.entry].key,
        distance: h.score,
        score: h.score,
        matchType: 'csr',
        kind: p.kind,
        direct: true,
        alignment: null,
        analysis: null,
        csr: {
          score: h.score,
          queryDialect: h.queryDialect,
          entryDialect: h.entryDialect,
          queryStem: h.queryStem,
          queryAffixes: h.queryAffixes,
          entryStem: h.entryStem,
          entryAffixes: h.entryAffixes,
          steps: null,
        },
      }
      const prev = best.get(p.doc)
      if (!prev || compareHits(hit, prev.hit) < 0) best.set(p.doc, { hit, source: h })
    }
  }
  const sorted = [...best.values()].sort((a, b) => compareHits(a.hit, b.hit))
  const sourceOf = new Map(sorted.map((x) => [x.hit, x.source]))
  const explain = (hit: EntryHit) => {
    const source = sourceOf.get(hit)
    if (hit.csr && source && hit.csr.steps === null) hit.csr.steps = search.explain(source)
  }
  response.entries = sorted.map((x) => x.hit)
  response.entryGroups = groupEntries(response.entries, {
    parent: ctx.docs.parent,
    children: ctx.childrenOf,
    doc: (k) => ctx.doc(k),
    key: (text) => ctx.text.searchKey(text),
  })
  // 說明（對齊）只為前幾筆計算：分數最好的幾筆，以及畫面上依家族排列時的前幾列（與一般搜尋相同）
  for (const hit of response.entries.slice(0, explainLimit)) explain(hit)
  let shown = 0
  for (const group of response.entryGroups) {
    for (const hit of group.spelling ? group.spelling.members.map((m) => m.hit) : collectHits(group.root)) {
      if (shown++ >= explainLimit) break
      explain(hit)
    }
    if (shown >= explainLimit) break
  }
  response.terms = hits.slice(0, 30).map((h) => ({ term: search.entries[h.entry].key, distance: h.score }))
  response.algorithm = 'csr'
  return true
}
