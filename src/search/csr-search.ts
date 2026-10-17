/**
 * @file 對應組檢索（實驗性；docs/csr.md）當作詞形比對的核心：一個查詢詞在詞庫中找到哪些詞。
 *
 * 搜尋選項 algorithm 'csr' 時，TermMatcher 以它取代 BCDP 的模糊比對與構詞搜尋（自動拆解、自動派生、自動同根），
 * 其餘照舊：開頭、結尾相符與包含、辭典標註的構詞關係、詞條與例句、搜尋方法的篩選與筆數。
 * 對應組檢索的分析對到既有的命中方式，讀者看到的分類與 BCDP 相同：
 * - 兩邊都沒有剝詞綴 → 模糊（fuzzy；同一個詞是完全相符）
 * - 只剝了查詢的詞綴 → 自動拆解（lemma）：查詢去詞綴後是這個詞
 * - 只剝了詞庫詞的詞綴 → 自動派生（derived）：這個詞是查詢加上詞綴
 * - 兩邊都剝 → 自動同根（sibling）：兩者推定來自同一個詞幹
 * 分數乘上模型的 scoreScale 換算成 BCDP 的刻度（打錯 4 → 0.8、每剝一個詞綴 3 → 0.6），
 * 與開頭相符、包含、辭典的構詞關係放在一起排序。
 *
 * 詞庫取自詞圖的每個詞（不含空白），方言由它出現的記錄決定：記錄的方言代碼對到模型的方言（下層變體算上層），
 * 沒有標記的依模型的 sourceDialects 由來源推定，都推不出來的是方言未知。同一個詞出現在幾個方言時各算一個。
 */

import { CorrespondenceSearch, type CsrEntry, type CsrFuzziness, type CsrHit, type CsrModel, type CsrStep } from './csr/index.ts'
import { decodeDialects, decodePosting, type SearchDocs } from './format.ts'
import type { MatchType } from './scoring.ts'
import type { CsrExplanation, TermMatch } from './types.ts'
import type { FuzzyIndex, LanguageProfile } from '#bcdp'

/** 對應組檢索與它的詞庫（第一次用到時由詞圖與記錄摘要建立） */
export interface CorrespondenceIndex {
  search: CorrespondenceSearch
  /** 詞庫的詞（搜尋鍵）在詞圖中的 posting */
  lookup: (term: string) => unknown[]
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
  const payloads = index.payloads
  index.terms.forEach((term, id) => {
    if (!term || /\s/u.test(term)) return
    const dialects = new Set<string | null>()
    for (const code of (payloads[id] ?? []) as number[]) dialects.add(dialectOf(decodePosting(code).doc))
    for (const dialect of dialects) entries.push({ key: term, dialect })
  })
  return { search: new CorrespondenceSearch({ model, profile, entries }), lookup: (term) => index.lookup(term) ?? [] }
}

/** 對應組檢索的分析 → 命中方式 */
function matchTypeOf(h: CsrHit): MatchType {
  const q = h.queryAffixes.length > 0, e = h.entryAffixes.length > 0
  return q && e ? 'sibling' : q ? 'lemma' : e ? 'derived' : 'fuzzy'
}

/**
 * 一個查詢詞的命中（每個詞取最好的分析）；分數已換算成 BCDP 的刻度。
 * @param key 已正規化、不含空白的查詢詞
 */
export function correspondenceMatches(index: CorrespondenceIndex, key: string, fuzziness: CsrFuzziness): TermMatch[] {
  const { search } = index
  const scale = search.params.scoreScale
  const best = new Map<string, TermMatch>()
  for (const h of search.search(key, { fuzziness })) {
    const term = search.entries[h.entry].key
    const score = Math.round(h.score * scale * 1000) / 1000
    if (best.has(term)) continue // 已依分數排序：第一個就是最好的
    const csr: CsrExplanation = {
      score,
      queryDialect: h.queryDialect,
      entryDialect: h.entryDialect,
      queryStem: h.queryStem,
      queryAffixes: h.queryAffixes,
      entryStem: h.entryStem,
      entryAffixes: h.entryAffixes,
      affixCost: Math.round(search.params.lambda * (h.queryAffixes.length + h.entryAffixes.length) * scale * 1000) / 1000,
      steps: null,
    }
    best.set(term, { term, payloads: index.lookup(term), distance: score, score, matchType: matchTypeOf(h), csr })
  }
  return [...best.values()]
}

/** 命中的對齊說明（每一步的成本也換算成 BCDP 的刻度） */
export function correspondenceSteps(index: CorrespondenceIndex, csr: CsrExplanation): CsrStep[] {
  const scale = index.search.params.scoreScale
  const scaled = (s: CsrStep): CsrStep => ({ ...s, cost: Math.round(s.cost * scale * 1000) / 1000, ...(s.parts ? { parts: s.parts.map(scaled) } : {}) })
  return index.search.explain(csr).map(scaled)
}
