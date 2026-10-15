/**
 * @file 搜尋引擎的型別：選項、命中與回應。網站前端（Web Worker 與介面）也用這些型別。
 */

import type { MorphStepHit } from '#bcdp'
import type { EntryGroup } from './family.ts'
import type { DocSummary, MatchKind } from './format.ts'
import type { MatchType, SearchMethod, SearchMethodGroup } from './scoring.ts'

/** 模糊程度 */
export type Fuzziness = 'exact' | 'normal' | 'loose'

/** 一種模糊程度的設定：依查詢長度 n（code point）決定距離門檻 */
export interface FuzzinessLevel {
  /** 介面顯示的名稱 */
  label: string
  maxDistance: (n: number) => number
  /** 正規化距離（距離 ÷ 較長字串長度）的上限 */
  maxNormalized: number
  /** 所有模糊命中都當詞根去找自動派生形（否則只用查詢本身與方言變體） */
  derivedFromAll: boolean
}

export interface SearchFilters {
  /** 只保留這些來源 */
  sources?: string[]
  /** 只保留含這些方言的記錄；特殊值 'none' 代表「未標方言」 */
  dialects?: string[]
  /** 只保留這些單位 */
  units?: string[]
  /** 只保留這些校對狀態 */
  statuses?: string[]
}

export interface ListOptions {
  filters?: SearchFilters
  /** text 依詞形排序；source 依來源內原本的順序（預設 text） */
  sort?: 'text' | 'source'
  offset?: number
  limit?: number
}

export interface SearchOptions {
  /** 預設 normal */
  fuzziness?: Fuzziness
  filters?: SearchFilters
  /** 要搜尋的部分：'native' 族語、'gloss' 釋義；預設兩者都搜 */
  fields?: string[]
  /** 每個區塊最多回傳筆數（預設 500） */
  limit?: number
  /** 為前幾筆模糊詞條附上對齊說明（預設 40） */
  explainLimit?: number
  /**
   * 不要的搜尋方法（見 scoring.ts 的 SEARCH_METHODS）：
   * 每筆記錄只在剩下的方法中挑最好的命中，被排除的方法不會壓在其他方法底下
   */
  exclude?: SearchMethod[]
}

/** 模糊命中時，非相同字元的對齊步驟 */
export interface AlignmentNote {
  op: string
  source: string
  target: string
  cost: number
  /** 規則分類（例如「閃音」） */
  category: string | null
}

/** 構詞命中的一個音變：落在前綴、詞幹、後綴，或詞素交界（交界上的增生、跨越交界的規則） */
export type MorphNote = AlignmentNote & { where: 'prefix' | 'stem' | 'suffix' | 'junction' }

/** 自動同根時，查詢拆出的詞根與拆法 */
export interface SiblingSplit {
  cost: number
  steps: MorphStepHit[]
  /** 詞庫外詞根的代價（virtualRootCost；詞庫中的詞根是 0） */
  penalty: number
  /** 詞根是詞庫中的詞 */
  lexical: boolean
  /** 詞根依音節數的成本（0 時省略） */
  rootCost?: number
}

export interface LemmaAnalysis {
  /** 詞幹（詞庫中的寫法） */
  stem: string
  /** 由外而內的構詞步驟 */
  steps: MorphStepHit[]
  /** 總成本：構詞步驟＋整個詞的音變＋詞根音節數的成本（docs/bcdp.md 1.2、1.6 第 9 項） */
  cost: number
  /** 最後一層的詞根依音節數的成本（rootSyllableCost；0 時省略） */
  rootCost?: number
  /** 自動派生以查詢的相近寫法當起點時，查詢本身 */
  variantOf?: string
  /** 查詢 → 起點的距離 */
  variantDistance?: number
  /** 查詢 → 起點的對齊說明 */
  variantNotes?: AlignmentNote[]
  /**
   * 自動派生經過其他詞時，由起點往下的每一層（不含最後一層，那一層就是 stem、steps）：
   * 查 sungut 找到 pausunguday，chain 是 [pusungut ＝ pu- ＋ sungut]，stem 是 pusungut
   */
  chain?: Array<{ term: string; stem: string; steps: MorphStepHit[]; cost: number; rootCost?: number }>
  /** 整個詞的音變說明（自動拆解只為前幾筆結果計算；還沒算時是 undefined，算不出時是 null） */
  notes?: MorphNote[] | null
  /**
   * 自動同根（matchType 'sibling'）：查詢拆出的詞根 root 與拆法；stem、steps、chain 是這個詞往上到 root 的路。
   * lexical：root 是詞庫中的詞（查 kali'angidan：root 是 angit，這個詞 'inangidan ＝ ‹in› ＋ 'angit ＋ -an，penalty 是 0）；
   * 否則是虛擬詞根（查 binubuer：root 是 bubuer（b<in>ubuer），這個詞 mabubuer ＝ ma- ＋ bubuer；
   * penalty 是詞庫外詞根的代價 virtualRootCost）。rootCost 是 root 依音節數的成本：
   * 詞庫中的詞根含在 cost 裡，虛擬詞根含在 penalty 裡
   */
  sibling?: SiblingSplit & { root: string }
  /** 句型搜尋的構詞樣式：這個詞最好的拆法的成本；比 cost 小時，這一種是次佳的拆法 */
  bestCost?: number
  /** 句型搜尋的構詞樣式：詞根（stem）是虛擬詞根，不在詞庫中 */
  virtual?: boolean
}

/** 辭典標註的構詞關係：root 確定派生、parent 確定拆解、sibling 確定同根（scoring.ts 的 KIND_RANK） */
export type DictionaryKind = 'root' | 'parent' | 'sibling'

export interface EntryHit {
  doc: DocSummary
  /** 命中的詞庫詞（搜尋鍵） */
  term: string
  /** 加權編輯距離；前綴／包含命中為 0 */
  distance: number
  /** 排序用的等效距離（見 scoring.ts） */
  score: number
  /** 以哪一種方式命中 */
  matchType: MatchType
  /** 詞與記錄的關係；root、parent、sibling 是辭典標註的構詞關係 */
  kind: MatchKind | 'parent' | 'sibling'
  /** 確定同根時，兩者共同的上層（辭典中的詞形） */
  via?: string
  /** 這筆記錄有沒有被查詢直接命中（不只經由辭典的構詞關係）；家族的排序只把直接的命中算成證據 */
  direct?: boolean
  alignment: AlignmentNote[] | null
  /**
   * 構詞分析：自動拆解（matchType 'lemma'）時是查詢的分析，
   * 自動派生（matchType 'derived'）時是命中詞的分析
   */
  analysis?: LemmaAnalysis | null
}

/** 一個查詢詞在詞庫中的命中 */
export interface TermMatch {
  term: string
  payloads: unknown[]
  distance: number
  matchType: MatchType
  /** 已經定下的分數（開頭相符又能自動派生時取兩者較好的；見 scoring.ts 的 mergeMorphMatch） */
  score?: number
  /** 被這個命中取代的其他命中（scoring.ts 的 alternativesOf） */
  others?: TermMatch[]
  /** 構詞命中（lemma 自動拆解、derived 自動派生）的分析 */
  analysis?: LemmaAnalysis
}

/** 例句中一個查詢詞的命中（欄位與 EntryHit 相同，介面共用同一套標籤） */
export interface OccurrenceMatch {
  /** 查詢詞 */
  word: string
  /** 查詢命中的詞庫詞（搜尋鍵）；kind 為 root 時是詞根，句中的詞在 token */
  term: string
  /** 句中命中的詞（搜尋鍵） */
  token: string
  /**
   * token：句中的詞就是 term；其他是辭典標註的構詞關係
   * （root：句中的詞是 term 的下層，查 usa 句中的 mukusa；parent：上層；sibling：同一個上層）
   */
  kind: 'token' | DictionaryKind
  /** 確定同根時，共同的上層 */
  via?: string
  matchType: MatchType
  distance: number
  /** 模糊命中的對齊說明（只為前幾句計算） */
  alignment: AlignmentNote[] | null
  /** 構詞命中的分析 */
  analysis: LemmaAnalysis | null
}

export interface OccurrenceHit {
  doc: DocSummary
  /** 句中命中的詞（搜尋鍵），供前端高亮 */
  terms: string[]
  /** 各查詢詞距離總和 */
  distance: number
  /** 排序用的等效距離總和 */
  score: number
  /** 各查詢詞中最弱的命中方式 */
  matchType: MatchType
  /** 每個查詢詞在這一句中決定分數的命中（說明標籤用） */
  matches: OccurrenceMatch[]
}

export interface GlossHit {
  doc: DocSummary
  field: 'zh' | 'en' | 'nan'
  /** 0 完全相同、1 開頭相同、2 整詞、3 部分 */
  rank: number
}

export interface SearchResponse {
  query: string
  mode: 'zh' | 'latin'
  /** 模糊搜尋命中的詞庫詞 */
  terms: Array<{ term: string; distance: number }>
  /** 詞條命中，依分數排序 */
  entries: EntryHit[]
  /** 同樣的詞條命中，依詞條家族分組（畫面顯示用，見 family.ts） */
  entryGroups: EntryGroup[]
  occurrences: OccurrenceHit[]
  glosses: GlossHit[]
  /** 截斷前的總數 */
  totals: { entries: number; entryGroups: number; occurrences: number; glosses: number }
  /** 每種搜尋方法找得到幾筆記錄（詞條與例句；不受 exclude 影響，介面用來顯示每個方法的數量） */
  methods: Record<SearchMethod, number>
  /**
   * 每一組搜尋方法（SEARCH_METHOD_GROUPS）找得到幾筆記錄：組內各方法的聯集，
   * 一筆記錄同時屬於組內好幾種方法時只算一次；同樣不受 exclude 影響
   */
  methodGroups: Record<SearchMethodGroup, number>
  stats: { elapsedMs: number; visitedNodes: number }
}
