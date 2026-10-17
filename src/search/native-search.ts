/**
 * @file 族語搜尋：詞條（詞形、變體、詞根、其他寫法）＋例句（句中出現）。
 *
 * 每個查詢詞先取得「命中的詞庫詞」清單（模糊＋前綴＋包含＋構詞，見 term-matcher.ts），
 * 再依 posting 分成詞條（entry-search.ts）與例句（occurrence-search.ts）兩區。
 * 對齊與構詞說明只為畫面上前幾筆計算。
 */

import { collectEntries, groupEntries, type EntryContext } from './entry-search.ts'
import { collectHits } from './family.ts'
import type { SearchDocs } from './format.ts'
import { MethodTally } from './method-tally.ts'
import { searchOccurrences, type OccurrenceContext } from './occurrence-search.ts'
import { compareHits, type MatchType } from './scoring.ts'
import type { TextTools } from './text.ts'
import type { AlignmentNote, CsrExplanation, FuzzinessLevel, LemmaAnalysis, SearchResponse } from './types.ts'

/** 族語搜尋需要的搜尋引擎部分（SearchEngine 本身就是一個） */
export interface NativeContext extends EntryContext, OccurrenceContext {
  docs: Pick<SearchDocs, 'parent'>
  text: Pick<TextTools, 'searchKey' | 'splitWords'>
  childrenOf: (k: number) => readonly number[]
  explainNotes(query: string, term: string): AlignmentNote[]
}

export interface NativeOptions {
  level: FuzzinessLevel
  accept: (k: number) => boolean
  /** 對齊與構詞說明只為前幾筆計算 */
  explainLimit: number
  /** false 時只做前綴／包含比對（中文查詢） */
  fuzzy: boolean
  /** 不要的搜尋方法 */
  exclude: ReadonlySet<string>
  /** 詞形比對的核心演算法（預設 bcdp） */
  algorithm?: 'bcdp' | 'csr'
}

/** 回傳的命中只顯示前幾個模糊命中的詞 */
const SHOWN_TERMS = 30

/**
 * 族語搜尋，結果寫進 response（terms、entries、entryGroups、occurrences、methods、methodGroups、stats）。
 * @param q 使用者輸入的查詢
 */
export function searchNative(ctx: NativeContext, q: string, response: SearchResponse, { level, accept, explainLimit, fuzzy, exclude, algorithm = 'bcdp' }: NativeOptions): void {
  const key = ctx.text.searchKey(q)
  if (!key) return
  const words = ctx.text.splitWords(q)

  const fullTerms = ctx.terms.match(key, level, response.stats, fuzzy, algorithm)
  response.terms = fullTerms
    .filter((t) => t.matchType === 'fuzzy')
    .slice(0, SHOWN_TERMS)
    .map(({ term, distance }) => ({ term, distance }))

  const tally = new MethodTally(exclude)
  const entries = collectEntries(ctx, key, fullTerms, accept, tally)
  response.entries = [...entries.values()].sort(compareHits)
  response.entryGroups = groupEntries(response.entries, {
    parent: ctx.docs.parent,
    children: ctx.childrenOf,
    doc: (k) => ctx.doc(k),
    key: (text) => ctx.text.searchKey(text),
  })

  // 對齊與構詞說明只為前幾筆計算：分數最好的幾筆，以及畫面上依家族排列時的前幾列
  const explain = createExplainer(ctx)
  for (const hit of response.entries.slice(0, explainLimit)) explain(key, hit)
  let shown = 0
  for (const group of response.entryGroups) {
    for (const hit of group.spelling ? group.spelling.members.map((m) => m.hit) : collectHits(group.root)) {
      if (shown++ >= explainLimit) break
      explain(key, hit)
    }
    if (shown >= explainLimit) break
  }

  // 已經是詞條命中的記錄不再列為例句
  response.occurrences = searchOccurrences(ctx, { key, words, fullTerms, level, fuzzy, algorithm, accept, stats: response.stats, tally }).filter((o) => !entries.has(o.doc.index))
  tally.writeTo(response)
  // 例句的命中說明與詞條相同，也只為前幾句計算
  for (const o of response.occurrences.slice(0, explainLimit)) for (const m of o.matches) explain(m.word, m)
}

/** 需要說明的命中（詞條或例句中的一個詞） */
interface Explainable {
  matchType: MatchType
  distance: number
  term: string
  alignment: AlignmentNote[] | null
  analysis?: LemmaAnalysis | null
  csr?: CsrExplanation
}

/**
 * 為命中補上對齊說明（模糊命中）與構詞的音變說明（自動拆解）。
 * 同一次搜尋中，同一對（查詢詞, 詞）的對齊只算一次（詞條與許多例句常是同一對）。
 */
function createExplainer(ctx: NativeContext): (word: string, hit: Explainable) => void {
  const aligned = new Map<string, AlignmentNote[]>()
  return (word, hit) => {
    // 對應組檢索找到的：說明是它自己的對齊（同一個物件由詞條與例句共用，只算一次）
    if (hit.csr) {
      if (hit.csr.steps === null) hit.csr.steps = ctx.terms.csrSteps(hit.csr)
      return
    }
    if (hit.matchType === 'fuzzy' && hit.distance > 0 && hit.alignment === null) {
      const k = `${word}\u0000${hit.term}`
      let notes = aligned.get(k)
      if (!notes) aligned.set(k, (notes = ctx.explainNotes(word, hit.term)))
      hit.alignment = notes
    }
    const a = hit.analysis
    if (a && a.notes === undefined) a.notes = ctx.terms.notesOf(a)
  }
}
