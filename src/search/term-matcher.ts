/**
 * @file 詞形比對：一個查詢詞在詞庫中的所有命中。一般搜尋（詞條、例句）與句型搜尋共用。
 *
 * 命中方式（scoring.ts 的 MATCH_TYPES）：
 * - 模糊（fuzzy）：加權編輯距離在模糊程度的門檻內，含完全相同與跨方言變體；
 * - 前綴、結尾、包含（prefix、suffix、substring）：substring-index.ts；
 * - 自動拆解（lemma）：構詞搜尋 BCDP（@babizu/bcdp 的 morph-search.ts），與模糊搜尋共用一次詞圖走訪；
 * - 自動派生、自動同根（derived、sibling）：derived-terms.ts。
 * 同一個詞有好幾種命中方式時的取捨見 scoring.ts 的 mergeMorphMatch。
 */

import type { FuzzyIndex, MorphSearch, Prepared, SearchResult } from '#bcdp'
import { DerivedTerms } from './derived-terms.ts'
import type { DerivationGraph } from './derivations.ts'
import { roundCost } from '#bcdp'
import { fuzzyOptions, lemmaMax } from './fuzziness.ts'
import { MORPHOLOGY_BASE_SCORE, mergeMorphMatch, type MatchType } from './scoring.ts'
import { SubstringIndex } from './substring-index.ts'
import type { AlignmentNote, FuzzinessLevel, LemmaAnalysis, MorphNote, TermMatch } from './types.ts'

/** 查詢的方言變體也拿來找自動派生形：只取距離這麼小、且全由方言規則構成的模糊命中 */
const DIALECT_VARIANT_DISTANCE = 0.3

/** 走訪統計（一次搜尋中各查詢詞累加；SearchResponse.stats 就是一個） */
export interface WalkStats {
  visitedNodes: number
}

/** 自動派生的一個起點：查詢本身或它的相近寫法 */
export interface DerivationStart {
  /** 自動派生圖的節點（詞編號） */
  id: number
  distance: number
  term: string
}

export interface TermMatcherDeps {
  index: FuzzyIndex
  /** 構詞搜尋（語言設定檔有 morphology 時才有）；沒有時不做自動拆解、自動派生 */
  morphSearch: MorphSearch | null
  /** 自動派生圖；沒有時不做自動派生 */
  derivations: DerivationGraph | null
  /** 虛擬詞根用的構詞搜尋（第一次用到時才建立） */
  virtualRootSearch: () => MorphSearch | null
  /** 兩個詞的對齊說明 */
  explainNotes: (query: string, term: string) => AlignmentNote[]
}

export class TermMatcher {
  /** 自動派生與自動同根 */
  readonly derived: DerivedTerms
  private readonly index: FuzzyIndex
  private readonly morphSearch: MorphSearch | null
  private readonly explainNotes: (query: string, term: string) => AlignmentNote[]
  private readonly substrings: SubstringIndex
  /** 自動拆解命中的音變說明（需要時才計算，notesOf） */
  private readonly lazyNotes = new WeakMap<LemmaAnalysis, () => MorphNote[]>()
  /** 構詞規格的 lemmaRulePenalty（自動拆解又要改寫詞幹時的排序加成） */
  private readonly lemmaRulePenalty: number

  constructor({ index, morphSearch, derivations, virtualRootSearch, explainNotes }: TermMatcherDeps) {
    this.index = index
    this.morphSearch = morphSearch
    this.lemmaRulePenalty = morphSearch?.spec.lemmaRulePenalty ?? 0
    this.explainNotes = explainNotes
    this.substrings = new SubstringIndex(index)
    this.derived = new DerivedTerms({ index, graph: derivations, virtualRootSearch, explainNotes })
  }

  /** 預先建立前綴／包含索引。 */
  warmup(): void {
    this.substrings.warmup()
  }

  /**
   * 一個查詢詞在詞庫中的所有命中：模糊＋前綴＋包含，有構詞規格時再加上自動拆解、自動派生、自動同根。
   * 精確模式（門檻 0）不做構詞搜尋：精確只比對拼寫相同的詞。
   *
   * @param key 已正規化的查詢詞（搜尋鍵）
   * @param stats 累加走訪統計
   * @param fuzzy 是否做模糊比對與構詞搜尋（中文查詢時關閉：加權編輯距離對中文沒有意義）
   */
  match(key: string, level: FuzzinessLevel, stats: WalkStats, fuzzy = true): TermMatch[] {
    const matches = new Map<string, TermMatch>()
    const morphology = fuzzy && this.morphSearch !== null && level.maxDistance(Array.from(key).length) > 0
    let lemma: TermMatch[] = []
    if (fuzzy) {
      const ms = morphology ? this.morphSearch : null
      const prepared = ms ? ms.seed(ms.prepare(key, lemmaMax(key, level)) ?? null, this.index) : null
      const { results, morph } = this.fuzzy(key, level, stats, prepared)
      if (prepared) lemma = this.lemma(key, level, prepared, morph)
      for (const r of results) {
        matches.set(r.term, {
          term: r.term,
          payloads: r.payloads,
          distance: r.distance,
          matchType: 'fuzzy',
        })
      }
    } else {
      // 不做模糊比對時（中文查詢），完全相同的詞要另外補上：
      // 模糊搜尋本來會涵蓋距離 0 的詞，而前綴／包含比對只找「比查詢長」的詞
      const payloads = this.index.lookup(key)
      if (payloads) matches.set(key, { term: key, payloads, distance: 0, matchType: 'fuzzy' })
    }
    for (const m of this.substrings.matches(key)) {
      if (!matches.has(m.term)) matches.set(m.term, m)
    }
    if (morphology) {
      // 查詢的相近寫法也當作詞根去找自動派生形（isDerivationVariant）
      const variants = [...matches.values()].filter((m) => m.matchType === 'fuzzy' && this.isDerivationVariant(key, level, m))
      // 同一個詞有多種命中方式時的取捨見 scoring.ts 的 mergeMorphMatch：開頭相符、包含的詞能自動拆解或派生時
      // 改以構詞命中呈現、分數取較好的；與模糊命中之間取分數較好的
      for (const m of [...lemma, ...this.derived.find(key, variants, lemmaMax(key, level), lemma)]) {
        matches.set(m.term, mergeMorphMatch(m, matches.get(m.term), key))
      }
    }
    return [...matches.values()]
  }

  /**
   * 普通模糊搜尋，順便跑構詞搜尋的通道：普通搜尋與構詞搜尋的各個還原變體共用一次詞圖走訪
   * （多通道，結果與分開搜尋相同）。
   * @param stats 累加走訪統計
   * @param prepared 構詞搜尋的準備結果（MorphSearch.prepare ＋ seed）
   * @returns results 依分數排序（與 FuzzyIndex.search 相同）；morph 是各構詞通道的結果，交給 lemma
   */
  fuzzy(key: string, level: FuzzinessLevel, stats: WalkStats, prepared: Prepared | null = null): { results: SearchResult[]; morph: SearchResult[][] } {
    const walk = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    const [plain, ...morph] = this.index.searchChannels([{ query: key, options: fuzzyOptions(key, level) }, ...(prepared?.channels ?? [])], walk)
    stats.visitedNodes += walk.visitedNodes
    // 與 FuzzyIndex.search 相同的排序
    plain.sort((a, b) => a.score - b.score || a.distance - b.distance || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    return { results: plain, morph }
  }

  /**
   * 自動拆解（去詞綴方向）：音變 ∘ 構詞 ∘ 詞庫的聯合搜尋 BCDP 的收尾。
   *
   * 分析的成本是構詞步驟加上整個詞的音變：同一套方言規則對整個詞計算，可以跨越詞素交界
   * （ta-kita-aw → takitaw），詞首、詞尾規則與構詞音變在交界也適用（packages/bcdp/docs/bcdp.md）。
   * 總成本上限是 lemmaMax。音變說明在需要時才計算（notesOf）。
   *
   * 構詞規格的 lemmaRulePenalty（κ，預設 0）大於 0 時，排序分數另加 κ ×（分析中的音變成本），
   * 音變成本 ＝ 分析成本 − 構詞步驟 − 詞根音節數的成本：既剝詞綴又改寫詞幹的分析排在只做其中一件事的命中之後
   * （研究紀錄見私有 repo 的 docs/research/explorations/p4-levels-bcdp.md）。回傳的命中與說明中的分析成本不變。
   *
   * @param prepared 構詞搜尋的準備結果
   * @param results 各構詞通道的結果（fuzzy 的 morph）
   */
  lemma(key: string, level: FuzzinessLevel, prepared: Prepared | null, results: SearchResult[][]): TermMatch[] {
    if (!prepared) return []
    const search = this.morphSearch as MorphSearch
    const penalty = this.lemmaRulePenalty
    return search.finish(prepared, results, lemmaMax(key, level)).map((h) => {
      const analysis: LemmaAnalysis = { stem: h.term, steps: h.steps, cost: h.distance, ...(h.rootCost ? { rootCost: h.rootCost } : {}) }
      this.lazyNotes.set(analysis, () => search.notesOf(prepared, h))
      const match: TermMatch = { term: h.term, payloads: h.payloads, distance: h.distance, matchType: 'lemma' as MatchType, analysis }
      if (penalty > 0) {
        const sound = h.distance - h.steps.reduce((s, x) => s + x.cost, 0) - (h.rootCost ?? 0)
        if (sound > 0) match.score = roundCost(MORPHOLOGY_BASE_SCORE + h.distance + penalty * sound)
      }
      return match
    })
  }

  /**
   * 只做自動拆解（不跑普通模糊搜尋、不看門檻是否為 0）：評估工具與測試比較兩個方向的對稱性時用。
   * 結果與 match 中的自動拆解相同。
   * @returns 沒有構詞規格時是空陣列
   */
  lemmaHits(key: string, level: FuzzinessLevel): TermMatch[] {
    const ms = this.morphSearch
    if (!ms) return []
    const prepared = ms.seed(ms.prepare(key, lemmaMax(key, level)) ?? null, this.index)
    return prepared ? this.lemma(key, level, prepared, this.index.searchChannels(prepared.channels)) : []
  }

  /** 自動拆解命中的音變說明（第一次要時才計算）；不是自動拆解的分析回傳 null。 */
  notesOf(analysis: LemmaAnalysis): MorphNote[] | null {
    return this.lazyNotes.get(analysis)?.() ?? null
  }

  /**
   * 自動派生的起點：查詢本身（在詞庫中時）與它可以當起點的相近寫法（isDerivationVariant），附上與查詢的距離。
   * 與 match 的自動派生用同一組起點；句型搜尋的 `pa-kita`、`@kita` 由這裡取得 kita 的起點。
   */
  derivationSeeds(key: string, level: FuzzinessLevel): DerivationStart[] {
    const { results } = this.fuzzy(key, level, { visitedNodes: 0 })
    const seeds: DerivationStart[] = []
    for (const s of [{ term: key, distance: 0 }, ...results.filter((m) => this.isDerivationVariant(key, level, m))]) {
      const id = this.index.dawg.lookup(s.term)
      if (id !== -1 && !seeds.some((x) => x.id === id)) seeds.push({ id, distance: s.distance, term: s.term })
    }
    return seeds
  }

  /**
   * 查詢的相近寫法 m 能不能也當自動派生的起點：標準只用方言變體（距離不大、全由方言規則構成；查 daux 也找得到 minudox），
   * 寬鬆用所有模糊命中（查 sugut 經 sungut 找到 pausunguday）。
   * @param m 模糊命中（距離 0 的是查詢本身，不算）
   */
  private isDerivationVariant(key: string, level: FuzzinessLevel, m: { term: string; distance: number }): boolean {
    if (m.distance <= 0) return false
    return level.derivedFromAll || (m.distance <= DIALECT_VARIANT_DISTANCE && this.explainNotes(key, m.term).every((s) => s.op === 'rule'))
  }
}
