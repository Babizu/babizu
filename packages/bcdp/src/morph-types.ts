/**
 * @file 構詞搜尋 BCDP 的型別：命中、通道（變體）、準備結果，以及各階段共用的 MorphContext。
 */

import type { WeightedEditDistance } from './distance.ts'
import type { FuzzyIndex, SearchOptions, SearchResult, SpreadCutoff } from './fuzzy-index.ts'
import type { JunctionEnd, TaggedEnd, TaggedState } from './junction.ts'
import type { Analyzer, AnalyzerSpec, MorphStep, NormalizedAffix, NormalizedCircumfix, ReduplicationPattern } from './morphology.ts'
import type { Rule } from './rules.ts'

/** 詞綴清單中的一項（已正規化；rank 是規格中的順序，同分時說明選較前的） */
export type AffixEntry = NormalizedAffix

/** 環綴（包覆單位，已正規化）：左邊的部分（前綴、中綴，或重疊型式）、外側的前綴與後綴 */
export type Circumfix = NormalizedCircumfix

/** 一層詞綴合併後的交界狀態；tags 記下每一格是哪一個詞綴（AffixEntry）取得最小值 */
export type Level = TaggedState

/**
 * 命中說明中的一個構詞步驟：form 是標準形式（規格中的寫法；重疊是查詢中的重疊部分；環綴是「左邊…後綴」），
 * cost 是步驟本身的成本（音變另外算在整個詞的對齊裡）
 */
export type MorphStepHit = MorphStep

export interface MorphHit {
  /** 命中的詞庫詞（詞幹） */
  term: string
  payloads: unknown[]
  /** 分析的成本：步驟成本＋整個詞的音變＋詞根音節數的成本（rootCost） */
  distance: number
  /** 詞根依音節數的成本（語言設定檔 rootSyllableCost；0 時省略） */
  rootCost?: number
  /** 由外而內 */
  steps: MorphStepHit[]
  /** 用了哪一個通道、哪些前綴與後綴（由外而內，不含環綴的兩側）、哪個環綴，說明（explainHit）用 */
  analysis: { variant: number; prefixes: AffixEntry[]; suffixes: AffixEntry[]; circumfix: Circumfix | null }
  /**
   * 同一個詞根、成本相同、步驟成本也相同（所以音變相同）、步驟不同的其他分析
   * （表面相同的不同讀法：元音開頭的詞根上前綴 a- 與中綴 <a>，ma- 與 m<a>）。steps 是依同分規則選的那一種（說明、自動派生圖用）；
   * 拆解表把每一種都收下，句型搜尋的構詞樣式才比得到任何一種讀法。
   */
  ties?: MorphStepHit[][]
}

/** 還原變體共用通道的一個步驟：成本移到詞尾耦合，詞尾取各步驟的最小值；命中是哪一個由出口決定 */
export interface VariantMember {
  op: MorphStepHit
  circumfix: Circumfix | null
  suffix: string | null
  cost: number
  rank: number
}

/** 一個搜尋通道：原查詢，或拿掉中綴、重疊部分的查詢 */
export interface Variant {
  /**
   * plain：沒有前綴、至少一個後綴；prefix：至少一個前綴；circumfix：前綴式的環綴緊貼詞幹；
   * infix、reduplication：還原變體（op 可以是環綴）
   */
  kind: 'plain' | 'prefix' | 'circumfix' | 'infix' | 'reduplication'
  /**
   * 這個通道的環綴（前綴式環綴的通道由後綴相同的幾個環綴共用，這裡是 null，
   * 命中是哪一個由起點狀態的 tag 決定）
   */
  circumfix: Circumfix | null
  /** 詞尾要接的環綴後綴（null：接一般的後綴鏈，或就是詞尾） */
  suffix: string | null
  /** 共用這個通道的步驟（前綴式環綴的通道：後綴相同的環綴；還原變體：單獨的中綴、重疊，與用它當左邊的環綴），說明用 */
  options?: MorphStepHit[]
  members?: VariantMember[]
  /**
   * 併進這個通道、要求詞根元音開頭的前綴式環綴（詞尾與這個通道相同）：以元音開頭的詞由
   * start ＝「原本的起點 ∪ 它們的起點」出發（FuzzyIndex 的 initialFrom）。start 每一格記著來源：
   * 原本的起點的 tag，或是哪一個環綴；說明時由它追溯一次
   */
  alt?: { options: MorphStepHit[]; start: Level }
  /** 這個通道只為 alt 而建：以其他字元開頭的詞沒有起點 */
  noBase?: boolean
  /** 查詢（變體是還原後的查詢） */
  chars: string[]
  /** 非串接步驟 */
  op: MorphStepHit | null
  /** 變體的詞幹起點（固定）；−1 表示不固定 */
  start: number
  /** 變體的詞幹前面有前綴鏈（否則詞幹在詞首） */
  prefixed: boolean
  /** 變體的詞幹前面緊貼的包覆單位前綴（起點取自「前綴鏈 · outer」的狀態） */
  outer?: string
  /** 詞幹起點的位置種類 */
  startEdge: number
  /** 變體拿掉的位置（原查詢） */
  cut: number
  /** 拿掉的字元數 */
  len: number
  /** 變體上詞幹可以結束的位置 */
  ends: (x: number) => boolean
}

/** 還原變體：另帶分組用的形狀（同一個位置、同一種拿法）、起點成本與規格中的順序 */
export type RestoredVariant = Variant & { shape: string; startCost: number; rank: number }

/** 詞幹通道的一個結果：詞圖走訪的結果，或 openStems 由交界列讀出的開放詞幹（沒有正規化分數） */
export type StemResult = Omit<SearchResult, 'score'>

/** 詞幹的一個搜尋通道（交給 FuzzyIndex.searchChannels） */
export interface StemChannel {
  query: string[]
  options: SearchOptions
}

/** 構詞搜尋的準備結果 */
export interface Prepared {
  query: string
  chars: string[]
  /** 第 1 … k 層前綴（正向） */
  prefixLevels: Level[]
  /** 第 1 … k 層後綴（反向：鏡像距離函式、反轉的查詢） */
  suffixLevels: Level[]
  /** 各層前綴再合併（tags 記的是層數 1 … k） */
  P: Level
  /** 各層後綴換成正向座標後合併（tags 記的是層數） */
  S: TaggedEnd & { row: Float64Array }
  /** 與 channels 一一對應 */
  variants: Variant[]
  channels: StemChannel[]
  /** 各通道共用的相對上限（seed 給起點，走訪時收緊） */
  cutoff: SpreadCutoff
  /** 還原變體超過 MAX_VARIANTS 而被截斷 */
  truncated: boolean
  /** 找回詞綴鏈的備忘（affixesOf） */
  chains?: Map<string, AffixEntry[]>
  /**
   * 環綴兩側：P 是前綴式環綴的左邊緊接在前綴鏈之後的狀態（依形式）；Sm 是各層後綴合併後的狀態（鏡像座標）；
   * S 是環綴的後綴緊接在後綴鏈之前的狀態（鏡像座標，與換回正向的耦合對象）
   */
  circ: { P: Map<string, Level>; Sm: Level; S: Map<string, { mirror: Level; end: JunctionEnd }> }
}

/** 命中的一則音變說明 */
export interface SoundNote {
  op: string
  source: string
  target: string
  cost: number
  category: string | null
  where: 'prefix' | 'stem' | 'suffix' | 'junction'
}

export interface MorphSearchDeps {
  /** 構詞規格（已正規化） */
  analyzer: Analyzer
  /** 與詞庫相同的距離函式（含構詞音變） */
  metric: WeightedEditDistance
  /** 詞庫 */
  index: FuzzyIndex
  /**
   * 詞庫中的詞是不是辭典的詞條或標為詞根（rootSyllableCost 的 entry；搜尋層由 posting 的種類判斷）。
   * 省略時一律當作詞條
   */
  isEntry?: (term: string) => boolean
}

/** 中綴與重疊的用法：單獨的步驟，或包覆單位的一部分（外側可以緊貼一個前綴 outer，詞尾可以要接它的後綴） */
export interface OpUse {
  op: (left: string) => MorphStepHit
  circumfix: Circumfix | null
  outer: string
  rank: number
}

/** 建立構詞搜尋器時算好、各階段共用的東西（不隨查詢改變；cache 是詞綴鏈的快取） */
export interface MorphContext {
  analyzer: Analyzer
  spec: AnalyzerSpec
  /** 與詞庫相同的距離函式，與它的鏡像（後綴由詞尾往內算） */
  metric: WeightedEditDistance
  mirror: WeightedEditDistance
  /** 詞庫 */
  index: FuzzyIndex
  /** 前綴 trie；反轉的後綴 trie（鏡像距離函式） */
  prefixIndex: FuzzyIndex
  suffixIndex: FuzzyIndex
  /** 環綴兩側：緊貼詞幹的前綴（詞綴 trie）、所有環綴的後綴（鏡像、反轉） */
  circPrefixIndex: FuzzyIndex
  circSuffixIndex: FuzzyIndex
  circumfixes: ReadonlyArray<Circumfix>
  /** 詞邊界字元（預設為空白）：詞綴、中綴、重疊部分都不能包含它（docs/bcdp.md 1.6） */
  isBoundary: (ch: string | undefined) => boolean
  /**
   * 交界上「只動查詢」的規則的 source：target 為空、可以用在詞素開頭（例如喉塞音 ' → ∅）。
   * 重疊部分與詞幹之間也是交界，這些字元屬於交界、不屬於詞幹，重疊模板略過它們（docs/bcdp.md 1.4）。
   */
  junctionInserts: string[][]
  /** 交界上的規則（構詞音變）：開放詞幹兩端的還原用。source 是查詢（表面）一側、target 是底層 */
  junctionRules: Rule[]
  /** 緊貼詞幹的前綴：前綴式環綴的左邊，或中綴、重疊式環綴外側的前綴 */
  innerPrefix: (c: Circumfix) => string
  /** 環綴的步驟（不隨查詢改變，只建一次、凍結） */
  stepOf: (c: Circumfix) => MorphStepHit
  infixUses: Array<OpUse & { form: string }>
  redupUses: Array<OpUse & { pattern: ReduplicationPattern }>
  /** 外側的前綴（'' ＝ 沒有，由自由的前綴鏈出發）→ 用到它的中綴、重疊 */
  outers: string[]
  /** 元音（要求詞幹元音開頭的環綴：通道只走元音開頭的詞） */
  vowelSet: Set<string>
  /** 詞根依音節數的成本（rootSyllableCost）：只依詞根本身，在詞尾加上，所以不改變同一個詞根選哪一種讀法 */
  syllableCost: (root: string, isEntry?: boolean) => number
  /** 詞庫詞根的成本：依音節數與是不是辭典的詞條 */
  rootCost: (term: string) => number
  hasRootCost: boolean
  /** 詞綴各層（Level[]）與環綴兩側（Map），依快取鍵；最近使用的留著 */
  cache: Map<string, Level[] | Map<string, Level>>
}
