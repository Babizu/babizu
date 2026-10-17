/**
 * @file 例句命中：每個查詢詞都要在句中出現，各詞的分數相加排序。
 *
 * 分數與詞條同一套規則（scoring.ts）：
 * - 句中的詞就是查詢命中的詞庫詞：詞的分數（完全相同、方言變體、開頭相符、自動拆解、自動派生、包含）；
 * - 句中的詞是辭典列在命中詞條下的派生詞（查 usa，句中的 mukusa）：詞的分數加上派生的層數，
 *   與詞條的「衍生自」（詞根 posting）相同。只從寫法與查詢相同的詞條展開。
 * 同一句同一個查詢詞有好幾種命中時取分數最好的一種，說明標籤（matches）也是那一種。
 */

import { roundCost } from '#bcdp'
import type { DictionaryRelations } from './dictionary-relations.ts'
import { decodePosting, type DocSummary } from './format.ts'
import type { MethodTally } from './method-tally.ts'
import { alternativesOf, compareOccurrences, MATCH_TYPE_RANK, MATCH_TYPES, methodOf, recordScore, replacesRecordHit, termScore, type MatchType } from './scoring.ts'
import type { TermMatcher, WalkStats } from './term-matcher.ts'
import type { FuzzinessLevel, OccurrenceHit, OccurrenceMatch, TermMatch } from './types.ts'

/** 例句命中需要的搜尋引擎部分 */
export interface OccurrenceContext {
  doc(k: number): DocSummary
  readonly terms: TermMatcher
  readonly relations: DictionaryRelations
}

export interface OccurrenceQuery {
  /** 整個查詢的搜尋鍵 */
  key: string
  /** 查詢中的詞（搜尋鍵）；空陣列時以整個查詢當一個詞 */
  words: string[]
  /** 整個查詢的命中（查詢只有一個詞時直接沿用，不再比對一次） */
  fullTerms: TermMatch[]
  level: FuzzinessLevel
  /** 是否做模糊比對（TermMatcher.match 的 fuzzy） */
  fuzzy: boolean
  /** 詞形比對的核心演算法（TermMatcher.match 的 algorithm） */
  algorithm?: 'bcdp' | 'csr'
  /** 篩選條件 */
  accept: (k: number) => boolean
  /** 累加走訪統計 */
  stats: WalkStats
  /** 記下每種搜尋方法找得到的句子，並決定命中是否保留 */
  tally: MethodTally
}

/** 一句在目前為止各查詢詞上的合計 */
interface Combined {
  distance: number
  score: number
  /** 最弱的命中方式（MATCH_TYPE_RANK） */
  rank: number
  terms: string[]
  matches: OccurrenceMatch[]
}

/**
 * 含有每個查詢詞的句子，依 compareOccurrences 排序。
 * 重複的查詢詞（例如 ma sa kau ma ngit 的 ma）只比對一次，走訪統計照樣累加，與逐次計算相同。
 */
export function searchOccurrences(ctx: OccurrenceContext, { key, words, fullTerms, level, fuzzy, algorithm = 'bcdp', accept, stats, tally }: OccurrenceQuery): OccurrenceHit[] {
  const seen = new Map<string, { terms: TermMatch[]; visited: number }>()
  const matchWord = (word: string) => {
    if (word === key) return fullTerms
    const prev = seen.get(word)
    if (prev) {
      stats.visitedNodes += prev.visited
      return prev.terms
    }
    const before = stats.visitedNodes
    const terms = ctx.terms.match(word, level, stats, fuzzy, algorithm)
    seen.set(word, { terms, visited: stats.visitedNodes - before })
    return terms
  }
  let combined: Map<number, Combined> | null = null
  for (const word of words.length > 0 ? words : [key]) {
    const found = placeWord(ctx, word, matchWord(word), accept, tally)
    combined = combined === null ? found : intersect(combined, found)
    if (combined.size === 0) break
  }
  return [...(combined ?? new Map<number, Combined>())]
    .map(([k, v]) => ({
      doc: ctx.doc(k),
      terms: [...new Set(v.terms)],
      distance: roundCost(v.distance),
      score: roundCost(v.score),
      matchType: MATCH_TYPES[v.rank] as MatchType,
      matches: v.matches,
    }))
    .sort(compareOccurrences)
}

/**
 * 一個查詢詞的命中落在哪些句子上，每句取最好的一種。
 * @param terms 這個查詢詞的命中
 */
function placeWord(ctx: OccurrenceContext, word: string, terms: TermMatch[], accept: (k: number) => boolean, tally: MethodTally): Map<number, Combined> {
  const found = new Map<number, Combined>()
  /** 句中的一個詞落在含它的各句上 */
  const place = (payloads: unknown[], score: number, match: OccurrenceMatch) => {
    const rank = MATCH_TYPE_RANK[match.matchType]
    const next = { matchType: match.matchType, score }
    const method = methodOf(match)
    const excluded = tally.isExcluded(method)
    for (const code of payloads as number[]) {
      const { doc: k, kind } = decodePosting(code)
      if (kind !== 'token' || !accept(k)) continue
      tally.count(k, method)
      if (excluded) continue
      const prev = found.get(k)
      const before = prev && { matchType: MATCH_TYPES[prev.rank], score: prev.score }
      // 只有自動同根命中的句子，遇到其他命中時整個換掉（高亮也只留那一種）；已有其他命中的句子不收自動同根
      if (!prev || (before?.matchType === 'sibling' && match.matchType !== 'sibling')) {
        found.set(k, { distance: match.distance, score, rank, terms: [match.token], matches: [match] })
      } else if (match.matchType === 'sibling' && before?.matchType !== 'sibling') continue
      else {
        prev.terms.push(match.token)
        if (replacesRecordHit(next, before, (a, b) => a.score - b.score)) {
          prev.rank = rank
          prev.score = score
          prev.distance = match.distance
          prev.matches = [match]
        }
      }
    }
  }
  for (const t of terms) {
    // 同一個詞的命中與被它取代的命中都放上去：被排除的方法在 place 裡略過，每句仍取剩下的最好的一種
    for (const c of alternativesOf(t)) {
      /** 同一個物件由含這個詞的各句共用：說明只算一次，每一句都看得到 */
      const match: OccurrenceMatch = { word, term: c.term, token: c.term, kind: 'token', matchType: c.matchType, distance: c.distance, alignment: null, analysis: c.analysis ?? null, ...(c.csr ? { csr: c.csr } : {}) }
      place(c.payloads, recordScore(termScore(c, word)), match)
    }
    // 辭典標註的構詞關係只從「就是查詢那個詞」的詞條展開（搜尋鍵相同）。寫法相近的詞條已經是一層不確定
    // （sungut 與 zenget 只差三條方言規則，卻是不同的詞），再加上辭典的關係就不是查詢的那個詞了；
    // 它們的派生詞仍可經由自動派生找到，分數照實加上寫法的差距
    if (t.matchType !== 'fuzzy' || t.distance > 0) continue
    const score = termScore(t, word)
    const base = { word, term: t.term, matchType: 'fuzzy' as MatchType, distance: 0, alignment: null, analysis: null }
    for (const d of ctx.relations.tokens(t)) {
      place(d.payloads, recordScore(score, d.depth), { ...base, token: d.term, kind: d.kind, ...(d.via ? { via: d.via } : {}) })
    }
  }
  return found
}

/** 兩個查詢詞都出現的句子：距離與分數相加，命中方式取較弱的 */
function intersect(a: Map<number, Combined>, b: Map<number, Combined>): Map<number, Combined> {
  const next = new Map<number, Combined>()
  for (const [k, v] of a) {
    const w = b.get(k)
    if (w) {
      next.set(k, {
        distance: v.distance + w.distance,
        score: v.score + w.score,
        rank: Math.max(v.rank, w.rank),
        terms: [...v.terms, ...w.terms],
        matches: [...v.matches, ...w.matches],
      })
    }
  }
  return next
}
