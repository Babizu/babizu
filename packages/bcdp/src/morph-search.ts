/**
 * @file 構詞搜尋：BCDP（Boundary-Coupled DP，邊界耦合 DP）。
 *
 * 問題（docs/bcdp.md 第 1 節）：查詢 q 是詞庫詞 t 的衍生形，可能帶著方言音變。一個「分析」是
 *
 *   前綴鏈 π ·（包覆單位）· 詞幹 t · 後綴鏈 σ
 *
 * 包覆單位（環綴）緊貼詞幹，至多一個，算一個步驟：前綴 L、詞幹上的中綴或重疊 op、後綴 R，至少兩個部分
 * （單獨的中綴、重疊也算：只有 op；要求詞根元音開頭的前綴可以只有 L）。構詞文法的組合規則展開後就是這些形狀（grammar.ts）。
 *
 * 成本是各步驟的成本，加上查詢與整個底層字串 π·L·op(t)·R·σ 的加權編輯距離：同一套方言規則對整個詞計算，
 * 規則可以跨越詞素交界（ta-kita-aw → takitaw 的 aa → a），詞首、詞尾規則在交界也適用，
 * 構詞音變是只在交界適用的規則，也在同一個 DP 裡。
 *
 * 做法：DP 在一個詞素交界的狀態（交界列＋還沒走完的規則，junction.ts 的 JunctionState）就是它的
 * 全部過去，所以整個詞可以一段一段走，每一段都是同一個原語——「從交界狀態出發，在 trie／詞圖上走訪」。
 * 同一個交界上不同來源的狀態逐項取 min 就能合併（(min, +) 線性，結果精確）：
 * 1. 前綴鏈：由詞首出發，一層一層走前綴 trie；第 s 層合併了所有「恰好 s 個前綴」的鏈
 * 2. 後綴鏈：用鏡像距離函式，在反轉的查詢上由詞尾往內，做法相同
 * 3. 詞幹：各層前綴合併成一個起點，與普通搜尋共用一次詞圖走訪；走到詞尾時與合併後的後綴狀態耦合，
 *    得到整個分析的成本
 * 中綴、重疊是查詢上的模板（重疊複製的是查詢中的形式）：先在查詢上還原，交界固定在查詢的位置上。
 * 包覆單位有前綴 L 時，詞幹的起點取自「前綴鏈 · L」的交界狀態（與前綴式環綴的左邊同一個量），而不是前綴鏈本身。
 * 要求詞根元音開頭的前綴式環綴不另建通道：併進詞尾相同的通道，只換以元音開頭的詞的起點（FuzzyIndex 的 initialFrom）。
 * 走訪得到的就是精確成本；是哪一條詞綴鏈，只對命中的詞另外追出來（合併時每一格都記著它來自哪個詞綴）。
 * 成本相同的分析，說明依固定的順序選一個（finish）：步驟少的優先，再依規格的順序（rank）。
 *
 * 詞根不在詞庫中（虛擬詞根，docs/bcdp.md 10.5）也是同一個 DP：同樣的通道，詞幹改成查詢中原樣的一段，
 * 成本直接由兩側的交界列讀出（openStems）。去詞綴只有這一套演算法。
 */

import type { Entry, SegmentOptions, WeightedEditDistance } from './distance.ts'
import { EDGE_JUNCTION, EDGE_WORD, EPSILON, roundCost } from './dp.ts'
import { FuzzyIndex, type NodeVisit, type SearchOptions, type SearchResult, type SpreadCutoff } from './fuzzy-index.ts'
import { requireCost, requireString } from './guards.ts'
import {
  copyTagged,
  emptyEnd,
  emptyJunction,
  isReachable,
  mergeEndInto,
  mergeInto,
  mergeTagged,
  minOf,
  toForwardEnd,
  type JunctionEnd,
  type TaggedEnd,
  type TaggedState,
} from './junction.ts'
import { circumfixStep, rootCostOf, type Analyzer, type Gloss, type MorphStep, type NormalizedAffix, type NormalizedCircumfix, type Part, type ReduplicationPattern } from './morphology.ts'

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
interface VariantMember {
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

/** restored 產生的變體：另帶分組用的形狀、起點成本與規格中的順序 */
type RestoredVariant = Variant & { shape: string; startCost: number; rank: number }

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

/** explainHit 的一段（詞素） */
interface Segment {
  chars: string[]
  lock: boolean
  type: 'prefix' | 'stem' | 'suffix'
  form: string
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

export type MorphSearch = ReturnType<typeof createMorphSearch>

/** 還原變體（中綴、重疊）的上限：防止很長的查詢展開成上百個通道；超過時 prepare 的結果標記 truncated */
const MAX_VARIANTS = 64

/** 詞綴鏈的快取上限（同一個網頁工作階段中重複查詢時省下重算） */
const CACHE_LIMIT = 500

/**
 * 建立構詞搜尋器。
 *
 * 詞綴索引在建立時就建好，詞綴鏈也會快取；之後若以 `metric.setRules` 換了方言規則，
 * 要呼叫 clearCache（或重新建立構詞搜尋器）。
 */
export function createMorphSearch({ analyzer, metric, index, isEntry = () => true }: MorphSearchDeps) {
  const spec = analyzer.spec
  const mirror = metric.mirror()
  const reverse = (s: string) => Array.from(s).reverse().join('')
  const prefixIndex = new FuzzyIndex(metric)
  for (const a of spec.prefixes) prefixIndex.add(a.form, a)
  const suffixIndex = new FuzzyIndex(mirror)
  for (const a of spec.suffixes) suffixIndex.add(reverse(a.form), a)
  /** 詞邊界字元（預設為空白）：詞綴、中綴、重疊部分都不能包含它（docs/bcdp.md 1.6） */
  const isBoundary = (ch: string | undefined) => ch !== undefined && metric.boundaries.has(ch)
  /**
   * 交界上「只動查詢」的規則的 source：target 為空、可以用在詞素開頭（例如喉塞音 ' → ∅）。
   * 重疊部分與詞幹之間也是交界，這些字元屬於交界、不屬於詞幹，重疊模板略過它們（docs/bcdp.md 1.4）。
   */
  const junctionInserts = [
    ...new Set(
      metric.ruleSet
        .expand(metric.normalize)
        .filter((r) => r.target === '' && r.source !== '' && r.position !== 'final')
        .map((r) => r.source),
    ),
  ].map((s) => Array.from(s))

  /** 環綴兩側：前綴式環綴的左邊（詞綴 trie）、所有環綴的後綴（鏡像、反轉） */
  const circumfixes: ReadonlyArray<Circumfix> = spec.circumfixes ?? []
  /** 緊貼詞幹的前綴：前綴式環綴的左邊，或中綴、重疊式環綴外側的前綴 */
  const innerPrefix = (c: Circumfix) => (c.kind === 'prefix' ? c.left : c.outer)
  const circPrefixIndex = new FuzzyIndex(metric)
  for (const c of circumfixes) {
    const left = innerPrefix(c)
    if (left && !circPrefixIndex.lookup(left)) circPrefixIndex.add(left, left)
  }
  const circSuffixIndex = new FuzzyIndex(mirror)
  for (const c of circumfixes) if (c.suffix && !circSuffixIndex.lookup(reverse(c.suffix))) circSuffixIndex.add(reverse(c.suffix), c.suffix)
  /** 中綴與重疊的用法：單獨的步驟，或包覆單位的一部分（外側可以緊貼一個前綴 outer，詞尾可以要接它的後綴） */
  type OpUse = { op: (left: string) => MorphStepHit; circumfix: Circumfix | null; outer: string; rank: number }
  /**
   * 不隨查詢改變的步驟（單獨的中綴、前綴式與中綴式環綴）只建一次、凍結，每個查詢共用；
   * 重疊的步驟帶著查詢中的重疊部分，每次另建
   */
  const fixedSteps = new Map<Circumfix, MorphStepHit>()
  const stepOf = (c: Circumfix) => {
    let s = fixedSteps.get(c)
    if (!s) fixedSteps.set(c, (s = Object.freeze(circumfixStep(c, c.left))))
    return s
  }
  const infixUses: Array<OpUse & { form: string }> = []
  for (const x of spec.infixes) {
    const s = Object.freeze(opStep('infix', x.form, x))
    infixUses.push({ form: x.form, op: () => s, circumfix: null, outer: '', rank: x.rank })
  }
  for (const c of circumfixes) if (c.kind === 'infix') infixUses.push({ form: c.left, op: () => stepOf(c), circumfix: c, outer: c.outer, rank: c.rank })
  const redupUses: Array<OpUse & { pattern: ReduplicationPattern }> = []
  for (const r of spec.reduplication) redupUses.push({ pattern: r.pattern, op: (red) => ({ ...opStep('reduplication', red, r), pattern: r.pattern }), circumfix: null, outer: '', rank: r.rank })
  for (const c of circumfixes) if (c.kind === 'reduplication') redupUses.push({ pattern: c.left as ReduplicationPattern, op: (red) => circumfixStep(c, red), circumfix: c, outer: c.outer, rank: c.rank })
  /** 元音（要求詞幹元音開頭的環綴：通道只走元音開頭的詞） */
  const vowelSet = new Set(Array.from(spec.vowels))
  /** 詞根依音節數的成本（rootSyllableCost）：只依詞根本身，在詞尾加上，所以不改變同一個詞根選哪一種讀法 */
  const syllableCost = rootCostOf(spec)
  /** 詞庫詞根的成本：依音節數與是不是辭典的詞條 */
  const rootCost = (term: string) => syllableCost(term, isEntry(term))
  const hasRootCost = spec.rootSyllableCost.entry.length > 0
  /** 外側的前綴（'' ＝ 沒有，由自由的前綴鏈出發）→ 用到它的中綴、重疊 */
  const outers = [...new Set(['', ...infixUses.map((u) => u.outer), ...redupUses.map((u) => u.outer)])]

  /** 詞綴各層（Level[]）與環綴兩側（Map），依快取鍵 */
  const cache = new Map<string, Level[] | Map<string, Level>>()

  /**
   * 詞綴鏈，一層一層合併：第 s 層是「恰好 s 個詞綴」的所有鏈在最內側交界的狀態，逐項取 min 合併成一個，
   * 每一格記下是哪一個詞綴取得最小值（同分時保留先找到的：trie 的順序）。每一層只走訪一次詞綴 trie：
   * 從上一層合併後的狀態出發，詞尾回報的交界狀態加上詞綴本身的成本，併進這一層。
   * 前綴由詞首往內；後綴用鏡像距離函式，在反轉的查詢上由詞尾往內，做法相同。
   * @param idx 前綴 trie，或鏡像距離函式的反轉後綴 trie
   * @param x 查詢（後綴時是反轉的查詢）
   * @param bound 總成本上限（之後的成本只會增加，超過的格子可以丟掉）
   * @param tag 快取鍵的前綴
   * @returns 第 1 … maxSteps 層（到沒有任何格子在上限內為止）
   */
  function levels(idx: FuzzyIndex, x: string[], bound: number, tag: string): Level[] {
    const key = `${tag}|${bound}|${x.join('')}`
    const cached = cache.get(key) as Level[] | undefined
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    const n = x.length
    const out: Level[] = []
    let prev: Level | undefined
    for (let s = 0; s < spec.maxSteps; s++) {
      const level: Level = emptyJunction(n)
      idx.searchChannels([
        {
          query: x,
          options: {
            maxDistance: bound,
            from: prev,
            lockBoundary: true, // 詞綴不含空白
            onJunction: (_form, state, payloads) => {
              for (const affix of payloads as AffixEntry[]) mergeInto(level, state, affix.cost, affix, byRank)
            },
          },
        },
      ])
      clip(level, bound)
      if (!isReachable(level)) break
      out.push(level)
      prev = level
    }
    cache.set(key, out)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    return out
  }

  /**
   * 環綴一側的交界狀態：在環綴那一側的 trie（前綴式環綴的左邊，或鏡像、反轉的後綴）上，由詞首（詞尾）
   * 與合併後的詞綴狀態各走訪一次，每個形式得到「它是最內層」時的交界狀態。
   * tag 記下來源：0 ＝ 詞首（詞尾），1 ＝ 接在詞綴鏈之後（說明時由那裡再追詞綴鏈）。
   * @param x 查詢（後綴時是反轉的查詢）
   * @param after 合併後的詞綴狀態
   * @param bound 總成本上限
   * @param tag 快取鍵的前綴
   * @returns 形式 → 交界狀態（只有到得了的）
   */
  function sides(idx: FuzzyIndex, x: string[], after: Level, bound: number, tag: string): Map<string, Level> {
    const key = `${tag}|${bound}|${x.join('')}`
    const cached = cache.get(key) as Map<string, Level> | undefined
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    const n = x.length
    const out = new Map<string, Level>()
    const origins: Array<{ from: Level | undefined; origin: number }> = [{ from: undefined, origin: 0 }]
    if (isReachable(after)) origins.push({ from: after, origin: 1 })
    for (const { from, origin } of origins) {
      idx.searchChannels([
        {
          query: x,
          options: {
            maxDistance: bound,
            from,
            lockBoundary: true, // 詞綴不含空白
            onJunction: (_form, state, payloads) => {
              for (const form of new Set(payloads as string[])) {
                let level = out.get(form)
                if (!level) out.set(form, (level = emptyJunction(n)))
                mergeInto(level, state, 0, origin)
              }
            },
          },
        },
      ])
    }
    for (const [form, level] of out) {
      clip(level, bound)
      if (!isReachable(level)) out.delete(form)
    }
    cache.set(key, out)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    return out
  }

  /**
   * 還原變體：在每個可能的詞幹起點 i 拿掉中綴或重疊部分。詞幹的起點依用法而定：
   * - 單獨的中綴、重疊（或沒有外側前綴的環綴）：詞首（沒有前綴），或某條前綴鏈的終點；
   * - 外側緊貼前綴 outer 的包覆單位（m<a>-）：「前綴鏈 · outer」的終點，成本取自 outer 那一側的狀態
   *   （與前綴式環綴的左邊同一個量，circP）。
   * 變體的交界固定在查詢的位置上：詞幹由 i 開始（規則不跨越），並在允許的位置結束。
   * 拿掉中綴之後詞幹的首輔音必須不變：m ＋ <a> 因此只接元音開頭的詞幹（mausa），mabaket 不會被當成 m<a>- ＋ baket。
   * @param P 各層前綴合併後的狀態
   * @param circP 緊貼詞幹的前綴（依形式）接在前綴鏈之後的狀態
   * @param circS 對得上查詢結尾的環綴後綴
   */
  function* restored(chars: string[], P: Level, circP: Map<string, Level>, circS: { has: (suffix: string) => boolean }): Generator<RestoredVariant> {
    const n = chars.length
    // 環綴的後綴對不上查詢的結尾時，這個用法不可能命中：先濾掉，不必試
    const usable = (u: OpUse) => !u.circumfix?.suffix || circS.has(u.circumfix.suffix)
    for (const outer of outers) {
      const xs = infixUses.filter((u) => u.outer === outer && usable(u))
      const rs = redupUses.filter((u) => u.outer === outer && usable(u))
      const starts: Array<{ i: number; startCost: number; prefixed: boolean }> = []
      if (!outer) {
        // 詞首（沒有前綴），或某條前綴鏈的終點（交界）。詞首與交界的語意不同（構詞音變只在交界適用），
        // 所以 i ＝ 0 時兩者都要試
        starts.push({ i: 0, startCost: 0, prefixed: false })
        for (let i = 0; i < n; i++) if (P.row[i] < Infinity) starts.push({ i, startCost: P.row[i], prefixed: true })
      } else {
        const Pc = circP.get(outer)
        if (Pc) for (let i = 0; i < n; i++) if (Pc.row[i] < Infinity) starts.push({ i, startCost: Pc.row[i], prefixed: true })
      }
      yield* restoredAt(chars, starts, xs, rs, outer)
    }
  }

  /**
   * 由給定的詞幹起點拿掉中綴或重疊部分（restored 的本體）。同一種拿法（同一個中綴形式、同一種重疊型式）
   * 只算一次，再給用到它的每個步驟各一個變體（單獨的中綴、重疊，與以它為左邊的環綴）。
   */
  function* restoredAt(
    chars: string[],
    starts: Array<{ i: number; startCost: number; prefixed: boolean }>,
    xs: Array<OpUse & { form: string }>,
    rs: Array<OpUse & { pattern: ReduplicationPattern }>,
    outer: string,
  ): Generator<RestoredVariant> {
    const n = chars.length
    const byForm = groupBy(xs, (x) => x.form)
    const byPattern = groupBy(rs, (r) => r.pattern)
    for (const { i, startCost, prefixed } of starts) {
      const head = Array.from(analyzer.onset(chars.slice(i).join('')))

      // 中綴：詞幹首輔音之後、首元音之前（首輔音不能含空白：構詞不跨越詞邊界）
      const at = i + head.length
      for (const [form, uses] of head.some(isBoundary) ? [] : byForm) {
        const infix = Array.from(form)
        if (chars.slice(at, at + infix.length).join('') !== form) continue
        const reduced = [...chars.slice(0, at), ...chars.slice(at + infix.length)]
        if (reduced.length - i < spec.minStem) continue
        if (analyzer.onset(reduced.slice(i).join('')) !== head.join('')) continue
        const ends = (e: number) => e > at // 詞幹必須越過中綴所在的位置
        for (const x of uses) {
          yield {
            kind: 'infix',
            chars: reduced,
            op: x.op(form),
            circumfix: x.circumfix,
            suffix: x.circumfix?.suffix || null,
            shape: `x|${prefixed}|${i}|${form}|${outer}`,
            start: i,
            startCost,
            prefixed,
            outer,
            rank: x.rank,
            startEdge: prefixed ? EDGE_JUNCTION : EDGE_WORD,
            cut: at,
            len: infix.length,
            ends,
          }
        }
      }

      // 重疊：詞幹前面的重疊部分，試每一種長度。模板只套用在詞幹上，而且詞幹取自查詢，
      // 所以複製的是查詢（方言）的形式；詞幹的長度只能是模板正好產生重疊部分的那些。
      // 重疊部分與詞幹之間是交界：交界上的增生（junctionInserts）不算在詞幹裡。
      // 重疊的詞幹開頭一定是交界，i ＝ 0 時由前綴鏈出發只會更貴，不必另外試
      for (const [pattern, uses] of prefixed && i === 0 ? [] : byPattern) {
        for (let len = 1; i + len < n; len++) {
          if (n - i - len < spec.minStem) break
          if (isBoundary(chars[i + len - 1])) break // 重疊部分不跨越空白
          const red = chars.slice(i, i + len).join('')
          const starts = [i + len]
          for (const g of junctionInserts) if (chars.slice(i + len, i + len + g.length).join('') === g.join('')) starts.push(i + len + g.length)
          for (const s of starts) {
            const base = chars.slice(s)
            if (base.length < spec.minStem) continue
            const lengths = analyzer.reduplicantStems(pattern, base, red)
            if (!lengths.length) continue
            const stemEnds = new Set(lengths.map((l) => s - len + l)) // 還原後的查詢上的位置
            const reduced = [...chars.slice(0, i), ...chars.slice(i + len)]
            const ends = (e: number) => stemEnds.has(e)
            for (const r of uses) {
              yield {
                kind: 'reduplication',
                chars: reduced,
                op: r.op(red),
                circumfix: r.circumfix,
                suffix: r.circumfix?.suffix || null,
                shape: `r|${prefixed}|${i}|${len}|${s}|${pattern}|${outer}`,
                start: i,
                startCost,
                prefixed,
                outer,
                rank: r.rank,
                startEdge: EDGE_JUNCTION,
                cut: i,
                len,
                ends,
              }
            }
          }
        }
      }
    }
  }

  /**
   * 構詞搜尋的第一步：算好前綴、後綴的各層與還原變體，產生詞幹的搜尋通道（交給 FuzzyIndex.searchChannels，
   * 搜尋引擎把它們與普通模糊搜尋合併成一次走訪）。
   * @param query 已正規化的查詢（搜尋鍵）
   * @param maxDistance 總成本上限
   * @returns 查詢太短時為 null
   */
  function prepare(query: string, maxDistance = 1): Prepared | null {
    requireString(query, '查詢')
    requireCost(maxDistance, 'maxDistance ')
    const chars = Array.from(query)
    const n = chars.length
    if (n < spec.minStem + 1) return null
    const prefixLevels = levels(prefixIndex, chars, maxDistance, 'p')
    const suffixLevels = levels(suffixIndex, [...chars].reverse(), maxDistance, 's')
    const P: Level = emptyJunction(n)
    prefixLevels.forEach((L, s) => mergeInto(P, L, 0, s + 1))
    const S = emptyEnd(n)
    suffixLevels.forEach((L, s) => mergeEndInto(S, toForwardEnd(L, mirror.compiled), s + 1))
    const word = new Float64Array(n + 1).fill(Infinity)
    word[n] = 0
    // 只保留「最佳 ＋ lemmaSpread」之內的詞根（finish），所以各通道共用一個相對上限，隨途中的最佳收緊。
    // 算進最佳的詞與 finish 相同（不是查詢本身、夠長），結果與不收緊時完全相同
    // 詞根成本（rootSyllableCost）也算進最佳：finish 比的是加上它的總成本。中途的剪枝比的是不含它的成本（下界），仍然精確
    const cutoff: SpreadCutoff = {
      best: Infinity,
      spread: spec.lemmaSpread,
      eligible: (term: string) => term !== query && Array.from(term).length >= spec.minStem,
      ...(hasRootCost ? { termCost: rootCost } : {}),
    }

    const variants: Variant[] = []
    const channels: StemChannel[] = []
    // 環綴的兩側：各自是最內層（緊貼詞幹），外面可以再接一般的詞綴鏈
    const Sm: Level = emptyJunction(n)
    suffixLevels.forEach((L, s) => mergeInto(Sm, L, 0, s + 1))
    const circSuffixes = circumfixes.some((c) => c.suffix) ? sides(circSuffixIndex, [...chars].reverse(), Sm, maxDistance, 'cs') : new Map<string, Level>()
    const circ: Prepared['circ'] = {
      P: circumfixes.some((c) => innerPrefix(c)) ? sides(circPrefixIndex, chars, P, maxDistance, 'cp') : new Map(),
      Sm,
      S: new Map([...circSuffixes].map(([form, L]) => [form, { mirror: L, end: toForwardEnd(L, mirror.compiled) }])),
    }

    const plain = { start: -1, prefixed: false, cut: n, len: 0, ends: () => true, circumfix: null, suffix: null }
    // 沒有前綴：至少要有一個後綴
    if (suffixLevels.length) {
      variants.push({ kind: 'plain', chars, op: null, startEdge: EDGE_WORD, ...plain })
      channels.push({ query: chars, options: { maxDistance, cutoff, to: { row: S.row, pending: S.pending, word: null } } })
    }
    // 至少一個前綴：之後可以接後綴，也可以就是詞尾
    if (prefixLevels.length) {
      variants.push({ kind: 'prefix', chars, op: null, startEdge: EDGE_JUNCTION, ...plain })
      channels.push({ query: chars, options: { maxDistance, cutoff, from: P, to: { row: S.row, pending: S.pending, word } } })
    }
    // 前綴式的環綴：詞幹由它的左邊出發（成本加在起點），詞尾一定接它的後綴。後綴相同的環綴詞尾耦合的對象相同，
    // 所以它們的起點（左邊的狀態加上環綴的成本）逐項取 min 合併成一個通道（定理 2）；tag 記著是哪一個環綴。
    // 要求詞根元音開頭的（vowelStem）另外合併成一個起點，只給以元音開頭的詞用（FuzzyIndex 的 initialFrom）：
    // 通道還是同一個，詞圖只走一次。沒有後綴的只有這一種，它們的詞尾與「接在前綴之後」的通道相同，併進那個通道
    const byEnd = new Map<string, { start: Level | null; startV: Level | null; options: MorphStepHit[]; optionsV: MorphStepHit[] }>()
    for (const c of circumfixes) {
      const Pc = c.kind === 'prefix' ? circ.P.get(c.left) : undefined
      if (!Pc || (c.suffix && !circ.S.has(c.suffix))) continue
      let group = byEnd.get(c.suffix)
      if (!group) byEnd.set(c.suffix, (group = { start: null, startV: null, options: [], optionsV: [] }))
      const step = stepOf(c)
      if (c.vowelStem) {
        mergeInto((group.startV ??= emptyJunction(n)), Pc, c.cost, c, byRank)
        group.optionsV.push(step)
      } else {
        mergeInto((group.start ??= emptyJunction(n)), Pc, c.cost, c, byRank)
        group.options.push(step)
      }
    }
    /**
     * 把要求元音開頭的環綴併進通道 k：以元音開頭的詞由「原本的起點 ∪ 它們的起點」出發（定理 2）。
     * 合併時每一格保留來源；同分依同分規則（步驟少的，再依規格的順序）
     */
    const addVowelStart = (k: number, startV: Level, optionsV: MorphStepHit[]) => {
      const { options } = channels[k]
      const from = options.from as Level | undefined
      const start = from ? mergeTagged(copyTagged(from), startV, fewerSteps(prefixLevels[0])) : startV
      options.initialFrom = { initials: vowelSet, from: start }
      variants[k].alt = { options: optionsV, start }
    }
    for (const [suffix, { start, startV, options, optionsV }] of byEnd) {
      const end = suffix ? (circ.S.get(suffix) as { end: JunctionEnd }).end : { row: S.row, pending: S.pending }
      // 起點與詞尾的成本都不小於它們的最小值：加起來已經超過上限的起點不可能有命中
      const endMin = Math.min(...(end.row as Float64Array), ...end.pending.map((q) => Math.min(...q.row)), suffix ? Infinity : 0)
      const reach = (L: Level | null): L is Level => L !== null && minOf(L) + endMin <= maxDistance + EPSILON
      const V = reach(startV) ? startV : null
      if (!suffix) {
        // 沒有後綴的只有要求元音開頭的：併進「接在前綴之後」的通道（沒有那個通道時另建一個，只給元音開頭的詞）
        if (!V) continue
        let k = variants.findIndex((v) => v.kind === 'prefix')
        if (k === -1) {
          k = variants.push({ kind: 'prefix', chars, op: null, startEdge: EDGE_JUNCTION, ...plain, noBase: true }) - 1
          channels.push({ query: chars, options: { maxDistance, cutoff, to: { row: S.row, pending: S.pending, word } } })
        }
        addVowelStart(k, V, optionsV)
        continue
      }
      const base = reach(start) ? start : null
      if (!base && !V) continue
      const k = variants.push({ kind: 'circumfix', chars, op: null, startEdge: EDGE_JUNCTION, ...plain, suffix, options, ...(base ? {} : { noBase: true }) }) - 1
      channels.push({ query: chars, options: { maxDistance, cutoff, ...(base ? { from: base } : {}), to: { row: end.row, pending: end.pending, word: null } } })
      if (V) addVowelStart(k, V, optionsV)
    }
    // 還原變體：同一個位置、同一種拿法（shape）的變體，拿掉之後的查詢、詞幹的起點與可以結束的位置都相同，
    // 只差在步驟成本與詞尾接什麼（單獨的中綴、重疊接一般的後綴鏈或就是詞尾；環綴接它的後綴）。
    // 把步驟成本移到詞尾（加法可以交換），詞尾取各步驟的最小值，就能共用一個通道（(min, +) 線性）
    const groups = new Map<string, { v: RestoredVariant; members: VariantMember[] }>()
    for (const v of restored(chars, P, circ.P, circ.S)) {
      let group = groups.get(v.shape)
      if (!group) groups.set(v.shape, (group = { v, members: [] }))
      const op = v.op as MorphStepHit
      group.members.push({ op, circumfix: v.circumfix, suffix: v.suffix, cost: op.cost, rank: v.rank })
    }
    let truncated = false
    let count = 0
    for (const { v, members } of groups.values()) {
      if (count++ >= MAX_VARIANTS) {
        truncated = true
        break
      }
      const m = v.chars.length
      const original = (x: number) => (x > v.cut ? x + v.len : x) // 變體上的位置 → 原查詢
      const from = new Float64Array(m + 1).fill(Infinity)
      from[v.start] = v.startCost
      const row = new Float64Array(m + 1).fill(Infinity)
      const vWord = new Float64Array(m + 1).fill(Infinity)
      for (const member of members) {
        const endRow = member.suffix === null ? S.row : ((circ.S.get(member.suffix) as { end: JunctionEnd }).end.row as Float64Array)
        for (let x = 0; x <= m; x++) if (v.ends(x)) row[x] = Math.min(row[x], member.cost + endRow[original(x)])
        if (member.suffix === null && v.ends(m)) vWord[m] = Math.min(vWord[m], member.cost)
      }
      const first = members[0]
      variants.push({ ...v, op: first.op, circumfix: first.circumfix, suffix: first.suffix, members, ...(members.length > 1 ? { options: members.map((x) => x.op) } : {}) })
      channels.push({
        query: v.chars,
        options: { maxDistance, cutoff, from: { row: from, pending: [] }, startEdge: v.startEdge, to: { row, pending: [], word: vWord } },
      })
    }
    return { query, chars, prefixLevels, suffixLevels, P, S, circ, variants, channels, cutoff, truncated }
  }

  /**
   * 走訪之前先給相對上限一個起點：詞幹與查詢的一段完全相同、兩側直接接上已算好的詞綴各層，
   * 這是一個真的分析，所以它的成本不小於最後的最佳（上限只會更緊、結果不變）。
   * 成本要與 finish 的相同：含詞根音節數的成本（rootSyllableCost）。少算的話起點比真正的最佳低，
   * 走訪會剪掉「最佳 ＋ lemmaSpread」之內的詞根（單音節的詞根最便宜、雙音節的稍貴時）。
   * 只查 idx 裡的詞：走訪的是哪個詞庫，就只能用哪個詞庫的詞當起點。
   * @param prepared null 原樣傳回，方便接在 prepare 之後
   * @param idx 接下來要走訪的詞庫（預設是建立時的詞庫）
   */
  function seed<T extends Prepared | null>(prepared: T, idx: FuzzyIndex = index): T {
    if (!prepared) return prepared
    const { chars, P, S, cutoff } = prepared
    const n = chars.length
    for (let x = 0; x + spec.minStem <= n; x++) {
      // 沒有前綴（一定要有後綴），或接在前綴之後（後綴可有可無）
      const bare = x === 0 ? 0 : Infinity
      const prefixed = P.row[x]
      if (bare === Infinity && prefixed === Infinity) continue
      let term = chars.slice(x, x + spec.minStem - 1).join('')
      for (let y = x + spec.minStem; y <= n; y++) {
        term += chars[y - 1]
        const cost = Math.min(bare + S.row[y], prefixed + (y === n ? 0 : S.row[y]))
        if (cost >= cutoff.best || term === prepared.query || idx.dawg.lookup(term) === -1) continue
        const total = hasRootCost ? roundCost(cost + rootCost(term)) : cost
        if (total < cutoff.best) cutoff.best = total
      }
    }
    return prepared
  }

  /** 交界上的規則（構詞音變）：開放詞幹兩端的還原用。source 是查詢（表面）一側、target 是底層 */
  const junctionRules = metric.ruleSet.expand(metric.normalize).filter((r) => r.junction)

  /**
   * 開放詞彙的詞幹（不在詞庫中；docs/bcdp.md 10.5）：**字面的**詞幹，就是通道查詢中原樣的一段 q[i..j)，
   * 只在兩端還原構詞音變；不做其他音變，規則也不跨進詞幹。所以整個詞的對齊在詞幹兩端的交界處斷開，
   * 最小成本直接由交界列讀出，不走訪任何詞圖（定理 A）：
   *
   *   cost(i, j) ＝ F[i] ＋ min(to.row[j], to.word[j])
   *
   * F 是起點那一側的交界列（前綴鏈、環綴的左邊、還原變體的固定起點；沒有時是詞首），to 是詞尾那一側的耦合
   * （row：接後綴；word：就是詞尾）。兩側各是所有詞綴鏈的逐項最小值（定理 2），所以這就是所有分析中的最小值。
   * 詞幹結尾接後綴時可以還原構詞音變（詞幹開頭接在前綴之後時同理），加上那條規則的成本。
   * 回傳與 FuzzyIndex.searchChannels 相同形狀的結果（每個通道一個陣列，帶著出口），直接交給 finish。
   * 每個通道 O(n²)。
   * @param options.keep 哪些詞幹要（例如不在詞庫中、形狀像詞根）
   * @param options.bound 成本上限
   */
  function openStems(prepared: Prepared, { keep, bound }: { keep: (stem: string) => boolean; bound: number }): StemResult[][] {
    return prepared.channels.map((ch) => {
      const q = ch.query
      const n = q.length
      const o = ch.options
      // 起點：通道的 from；沒有 from 時是詞首（只有 initialFrom 的通道，其他字元開頭的詞沒有起點，與走訪相同）
      const base = o.from ? o.from.row : o.initialFrom ? null : Float64Array.from({ length: n + 1 }, (_, x) => (x === 0 ? 0 : Infinity))
      const junctionStart = Boolean(o.from) && o.startEdge !== EDGE_WORD
      const to = o.to as JunctionEnd
      const out = new Map<string, StemResult>()
      const put = (stem: string, cost: number, kind: 'row' | 'word', x: number) => {
        if (cost > bound + EPSILON || Array.from(stem).length < spec.minStem || !keep(stem)) return
        const prev = out.get(stem)
        if (!prev || cost < prev.distance - EPSILON) out.set(stem, { term: stem, payloads: [], distance: cost, exit: { kind, x, tail: -1 } })
      }
      /** 底層的第一個字元決定起點（要求詞根元音開頭的環綴另有起點） */
      const startOf = (i: number, first: string) => (o.initialFrom?.initials.has(first) ? o.initialFrom.from.row[i] : (base?.[i] ?? Infinity))
      for (let i = 0; i < n; i++) {
        let span = ''
        for (let j = i + 1; j <= n; j++) {
          if (isBoundary(q[j - 1])) break // 開放詞幹是單一個詞
          span += q[j - 1]
          const endJ = to.row ? to.row[j] : Infinity
          const endW = to.word ? to.word[j] : Infinity
          // 詞幹的開頭：原樣，或（接在前綴之後時）還原一條構詞音變；結尾：原樣，或（接後綴時）還原一條。兩端可以同時
          const heads: Array<{ head: string; skip: number; cost: number }> = [{ head: '', skip: 0, cost: 0 }]
          if (junctionStart) for (const r of junctionRules) if (r.position !== 'final' && span.startsWith(r.source)) heads.push({ head: r.target, skip: r.source.length, cost: r.weight })
          const tails: Array<{ tail: string; skip: number; cost: number; kind: 'row' | 'word' }> = [{ tail: '', skip: 0, cost: Math.min(endJ, endW), kind: endJ <= endW ? 'row' : 'word' }]
          if (endJ < Infinity) for (const r of junctionRules) if (r.position !== 'initial' && span.endsWith(r.source)) tails.push({ tail: r.target, skip: r.source.length, cost: endJ + r.weight, kind: 'row' })
          for (const h of heads) {
            for (const t of tails) {
              if (t.cost === Infinity || h.skip + t.skip > span.length) continue
              const stem = h.head + span.slice(h.skip, span.length - t.skip) + t.tail
              if (!stem) continue
              const F = startOf(i, Array.from(stem)[0])
              if (F < Infinity) put(stem, F + h.cost + t.cost, t.kind, j)
            }
          }
        }
      }
      return [...out.values()]
    })
  }

  /**
   * 一格（交界列的第 x 格，或跨界狀態 node 的第 x 格）的 tag。
   * @param key 跨界狀態的鍵（預設 entry.node）
   */
  const tagAt = (state: { tags?: { row: unknown[]; pending: Map<unknown, unknown[]> } }, entry: Entry, key?: unknown): unknown => {
    if (entry.kind === 'start') return null
    if (entry.kind === 'row') return state.tags?.row[entry.x] ?? null
    return state.tags?.pending.get(key ?? entry.node)?.[entry.x] ?? null
  }

  /**
   * 由某一層的一格往回追出整條詞綴鏈：這一格記著是哪個詞綴；在那個詞綴上由前一層出發做一次追蹤 DP，
   * 找到它是由前一層的哪一格進來的，一直追到詞首（詞尾）。
   * @param m 距離函式（後綴用鏡像的）
   * @param list 各層
   * @param s 從第 s 層開始（1 起算）
   * @param x 查詢（後綴用反轉的查詢）
   * @param charsOf 詞綴的字元（後綴要反轉）
   * @returns 由外而內
   */
  function chainFrom(m: WeightedEditDistance, list: Level[], s: number, entry: Entry, x: string[], charsOf: (form: string) => string[]): AffixEntry[] {
    const out: AffixEntry[] = []
    let at = entry
    for (let k = s; k >= 1 && at.kind !== 'start'; k--) {
      const affix = tagAt(list[k - 1], at) as AffixEntry | null
      if (!affix) break
      out.push(affix)
      const t = m.traceSegment(x, charsOf(affix.form), { from: k >= 2 ? list[k - 2] : null, lock: true, exit: at })
      at = t.entry
    }
    return out.reverse()
  }

  /**
   * 命中是由哪些詞綴來的：在詞幹上做一次追蹤 DP（與走訪同一個起點與耦合），得到它由合併後的前綴狀態的哪一格
   * 進來、在後綴狀態的哪一格出去，再各自往回追出詞綴鏈。
   * @param c 通道
   * @param result 這個通道走訪到的結果（帶著耦合的出口）
   */
  function affixesOf(prepared: Prepared, c: number, result: StemResult) {
    const v = prepared.variants[c]
    const options = prepared.channels[c].options
    // 以元音開頭的詞，在併進了要求元音開頭的環綴的通道上，由合併後的起點出發（與走訪相同）
    const start = v.alt && vowelSet.has(Array.from(result.term)[0]) ? v.alt.start : (options.from as Level | undefined)
    // 「接在前綴之後」與前綴式環綴的通道不知道詞幹從哪一格進來，要在詞幹上做一次追蹤 DP；其他通道的起點
    // 是詞首或固定的位置，出口走訪時已經記下（與追蹤 DP 的結果相同，所以不必再算）。
    // 命中的成本有限，所以追蹤 DP 一定找得到出口：耦合的出口已換成詞尾、交界列或跨界狀態（與走訪的出口同一種形狀）
    const t: { entry: Entry; exit: { kind: string; x: number; tail?: number } } =
      v.kind === 'prefix' || v.kind === 'circumfix' || !result.exit
        ? (metric.traceSegment(v.chars, Array.from(result.term), {
            from: start ?? null,
            startEdge: options.startEdge,
            exit: { kind: 'couple', to: options.to as JunctionEnd },
          }) as { entry: Entry; exit: { kind: string; x: number; tail?: number } })
        : { entry: { kind: 'start' }, exit: result.exit }
    // 詞綴鏈只取決於（哪一側、第幾層、從哪一格往回追），同一次查詢的命中常常共用，所以備忘在 prepared 上
    const memo = (prepared.chains ??= new Map())
    const chain = (side: string, level: number, at: Entry, compute: () => AffixEntry[]) => {
      const key = `${side}|${level}|${at.kind}|${'x' in at ? at.x : ''}|${'node' in at ? at.node : ''}`
      let out = memo.get(key)
      if (!out) memo.set(key, (out = compute()))
      return out.slice()
    }
    /** 由合併後的前綴狀態 P 的一格往回追出前綴鏈 */
    const prefixChain = (at: Entry) => {
      if (at.kind === 'start') return []
      const level = (tagAt(prepared.P, at) ?? 0) as number
      return chain('p', level, at, () => chainFrom(metric, prepared.prefixLevels, level, at, prepared.chars, (f) => Array.from(f)))
    }
    const reversed = [...prepared.chars].reverse()
    /** 由合併後的後綴狀態（鏡像座標）的一格往回追出後綴鏈 */
    const suffixChain = (at: Entry, level: number) => chain('s', level, at, () => chainFrom(mirror, prepared.suffixLevels, level, at, reversed, (f) => Array.from(f).reverse()))

    let prefixes: AffixEntry[]
    /** 這個命中用的非串接步驟或環綴 */
    let op = v.op
    let circumfix = v.circumfix
    let suffix = v.suffix
    /** 非串接步驟或環綴在規格中的順序（同分時說明選較前的） */
    let rank: number | null = v.members ? null : (v.circumfix?.rank ?? null)
    const n = prepared.chars.length
    if (v.members) {
      // 共用通道的變體：出口的成本是哪一個步驟給的（同分取規格中較前的）
      const exit = t.exit
      const x = exit.x > v.cut ? exit.x + v.len : exit.x
      let best = Infinity
      for (const member of v.members) {
        let cost = Infinity
        if (exit.kind === 'word') cost = member.suffix === null ? member.cost : Infinity
        else {
          const endRow = member.suffix === null ? prepared.S.row : ((prepared.circ.S.get(member.suffix) as { end: JunctionEnd }).end.row as Float64Array)
          cost = member.cost + endRow[x]
        }
        if (cost < best - EPSILON || (cost <= best + EPSILON && rank !== null && member.rank < rank)) {
          best = Math.min(best, cost)
          ;({ op, circumfix, suffix, rank } = member)
        }
      }
    }
    // 起點那一格的來源：前綴式環綴的通道一定是環綴；併進了元音開頭環綴的「接在前綴之後」通道，可能是環綴，
    // 也可能是原本的前綴鏈（tag 是層數）
    const startTag = v.kind === 'circumfix' || start !== options.from ? tagAt(start as Level, t.entry) : null
    if (startTag !== null && typeof startTag === 'object') {
      // 詞幹由合併後的起點進來：那一格的 tag 是哪一個環綴；環綴左邊的狀態再記著它是從詞首（0）
      // 還是從前綴鏈之後（1）走過來的
      circumfix = startTag as Circumfix
      suffix = circumfix.suffix || null
      op = stepOf(circumfix)
      rank = circumfix.rank
      const Pc = prepared.circ.P.get(circumfix.left) as Level
      if (tagAt(Pc, t.entry) === 1) {
        const back = metric.traceSegment(prepared.chars, Array.from(circumfix.left), { from: prepared.P, lock: true, exit: t.entry as Entry & { kind: 'row' | 'pending' } })
        prefixes = prefixChain(back.entry)
      } else prefixes = []
    } else if (v.outer) {
      // 包覆單位的前綴緊貼詞幹：詞幹起點那一格記著它是從詞首（0）還是從前綴鏈之後（1）走過來的，
      // 從前綴鏈之後時，在前綴上追一次，找到前綴鏈的終點再往回追（與前綴式環綴相同）
      const Pc = prepared.circ.P.get(v.outer) as Level
      const at: Entry = { kind: 'row', x: v.start }
      if (tagAt(Pc, at) === 1) {
        const back = metric.traceSegment(prepared.chars, Array.from(v.outer), { from: prepared.P, lock: true, exit: at })
        prefixes = prefixChain(back.entry)
      } else prefixes = []
    } else {
      // 變體的起點固定在 v.start（有前綴鏈時由合併後的前綴狀態的那一格往回追）
      prefixes = prefixChain(v.start >= 0 ? (v.prefixed ? { kind: 'row', x: v.start } : { kind: 'start' }) : t.entry)
    }

    // 後綴：出口換成反向座標（位置 x → n − x；跨界狀態的 tail 反轉後是鏡像 trie 的節點）
    const exit = t.exit
    let suffixes: AffixEntry[] = []
    if (exit.kind === 'row' || exit.kind === 'pending') {
      const x = exit.x > v.cut ? exit.x + v.len : exit.x
      const to = options.to as JunctionEnd
      const back: Entry =
        exit.kind === 'row'
          ? { kind: 'row', x: n - x }
          : { kind: 'pending', node: mirror.compiled.trieWalk(0, [...to.pending[exit.tail as number].tail].reverse()), x: n - x }
      if (suffix !== null) {
        // 環綴的後綴：它的狀態記著是從詞尾（0）還是從後綴鏈之前（1）走過來的
        const Sc = prepared.circ.S.get(suffix) as { mirror: Level }
        if (tagAt(Sc.mirror, back) === 1) {
          const e = mirror.traceSegment(reversed, Array.from(suffix).reverse(), { from: prepared.circ.Sm, lock: true, exit: back as Entry & { kind: 'row' | 'pending' } })
          if (e.entry.kind !== 'start') suffixes = suffixChain(e.entry, (tagAt(prepared.circ.Sm, e.entry) ?? 0) as number)
        }
      } else if (exit.kind === 'row') suffixes = suffixChain(back, (prepared.S.tags.row[x] ?? 0) as number)
      else {
        const tail = prepared.S.pending[exit.tail as number].tail
        suffixes = suffixChain(back, (prepared.S.tags.pending.get(tail.join(''))?.[x] ?? 0) as number)
      }
    }
    return { prefixes, suffixes, op, circumfix, rank }
  }

  /**
   * 構詞搜尋的第二步：整理各通道的結果，每個詞取最小成本，並找出是哪些詞綴。
   * @param resultsPerChannel 與 prepared.channels 對應
   * @param maxDistance 總成本上限
   * @returns 依成本排序（同分依詞），只保留「最佳 ＋ lemmaSpread」之內
   */
  function finish(prepared: Prepared, resultsPerChannel: StemResult[][], maxDistance: number): MorphHit[] {
    const { query } = prepared
    const best = new Map<string, { distance: number; term: string; candidates: Array<{ channel: number; result: StemResult }> }>()
    prepared.channels.forEach((_, c) => {
      for (const r of resultsPerChannel[c] ?? []) {
        if (r.term === query || Array.from(r.term).length < spec.minStem || r.distance > maxDistance + EPSILON) continue
        // 成本＝走訪的成本（步驟＋音變）＋詞根成本。上限比的是走訪的成本：詞根成本只改名次與候選範圍（最佳 ＋ lemmaSpread），
        // 不讓本來在上限內的分析因為它消失（罕見而正確的詞根不能被排除）
        const distance = hasRootCost ? roundCost(r.distance + rootCost(r.term)) : r.distance
        const prev = best.get(r.term)
        if (!prev || distance < prev.distance - EPSILON) best.set(r.term, { distance, term: r.term, candidates: [{ channel: c, result: r }] })
        else if (distance <= prev.distance + EPSILON) prev.candidates.push({ channel: c, result: r })
      }
    })
    const sorted = [...best.values()].sort((a, b) => a.distance - b.distance || (a.term < b.term ? -1 : 1))
    if (sorted.length === 0) return []
    const cutoff = sorted[0].distance + spec.lemmaSpread + EPSILON
    return sorted
      .filter((h) => h.distance <= cutoff)
      .map((h) => {
        // 成本相同的分析（不同通道）：說明選步驟少的，再依規格中的順序（tieKey）；成本不受影響。
        // 其他步驟不同的分析也留著（ties）：表面相同的不同讀法，拆解表要每一種都有
        let pick: { channel: number; result: StemResult; a: ReturnType<typeof affixesOf>; key: number[] } | null = null
        const all: MorphStepHit[][] = []
        for (const { channel, result } of h.candidates) {
          const a = affixesOf(prepared, channel, result)
          all.push(stepsOf(a))
          const key = tieKey(a)
          if (!pick || compareKeys(key, pick.key) < 0) pick = { channel, result, a, key }
        }
        const { channel, result, a } = pick as NonNullable<typeof pick>
        const { prefixes, suffixes, circumfix } = a
        const steps = stepsOf(a)
        const seen = new Set([stepsKey(steps)])
        // 只收步驟成本也相同的讀法（音變的分量才相同）：多一個步驟、少一些音變的讀法（morohot 的 m- ＋ o~ ＋ ruhut）
        // 總成本相同，卻能鑽過精確模式「音變不超過 0.2」的上限，它不是同一種讀法的另一種寫法
        const stepCost = stepCostOf(steps)
        const ties: MorphStepHit[][] = []
        for (const s of all) {
          const k = stepsKey(s)
          if (!seen.has(k) && Math.abs(stepCostOf(s) - stepCost) <= EPSILON) seen.add(k), ties.push(s)
        }
        const rc = hasRootCost ? rootCost(result.term) : 0
        return {
          term: result.term,
          payloads: result.payloads,
          distance: roundCost(h.distance),
          ...(rc > 0 ? { rootCost: rc } : {}),
          steps,
          analysis: { variant: channel, prefixes, suffixes, circumfix },
          ...(ties.length ? { ties } : {}),
        }
      })
  }

  /**
   * 命中的完整說明：整個詞的聯合對齊（metric.explainSegments），各詞素依序接起來，
   * 變體的交界固定在查詢的位置上。對齊的距離加上步驟成本就是命中的成本（測試逐一比對）。
   */
  function explainHit(prepared: Prepared, hit: MorphHit) {
    const v = prepared.variants[hit.analysis.variant]
    const { prefixes, suffixes, circumfix } = hit.analysis
    const affix = (type: 'prefix' | 'suffix', form: string): Segment => ({ chars: Array.from(form), lock: true, type, form })
    // 環綴緊貼詞幹：前綴式的左邊（或中綴、重疊式外側的前綴）是最內層的前綴，後綴是最內層的後綴
    // （中綴、重疊在詞幹上，變體已經拿掉）
    const innerForm = circumfix ? innerPrefix(circumfix) : ''
    const inner = innerForm ? [affix('prefix', innerForm)] : []
    const segments: Segment[] = [
      ...prefixes.map((a) => affix('prefix', a.form)),
      ...inner,
      { chars: Array.from(hit.term), lock: false, type: 'stem', form: hit.term },
      ...(circumfix?.suffix ? [affix('suffix', circumfix.suffix)] : []),
      // 後綴由外而內，在詞中的順序要反過來
      ...[...suffixes].reverse().map((a) => affix('suffix', a.form)),
    ]
    const stem = prefixes.length + inner.length
    const options: SegmentOptions = {}
    if (v.kind === 'infix' || v.kind === 'reduplication') {
      if (stem === 0) options.startEdge = v.startEdge
      options.pinStart = { segment: stem, x: v.start }
      options.pinEnd = { segment: stem, allowed: new Set(Array.from({ length: v.chars.length + 1 }, (_, x) => x).filter(v.ends)) }
    }
    return { query: v.chars, segments, stem, explanation: metric.explainSegments(v.chars, segments, options) }
  }

  /**
   * 命中的音變說明：整個詞的對齊中不是「相同」的每一步，標出它落在哪裡——前綴、詞幹、後綴，
   * 或詞素交界（只動查詢的操作在交界上，或規則跨越了交界）。成本加起來是整個詞的音變。
   */
  function notesOf(prepared: Prepared, hit: MorphHit): SoundNote[] {
    const { segments, explanation } = explainHit(prepared, hit)
    return notesFrom(segments, explanation)
  }

  function notesFrom(segments: Array<{ type: 'prefix' | 'stem' | 'suffix' }>, explanation: ReturnType<WeightedEditDistance['explainSegments']>): SoundNote[] {
    const junctions = new Set(explanation.junctions)
    const typeAt = (j: number) => segments[explanation.segmentOf[j]]?.type ?? 'stem'
    return explanation.alignment
      .filter((s) => s.op !== 'match')
      .map((s) => {
        const [, b0] = s.from
        const [, b] = s.to
        let where: SoundNote['where']
        if (b0 === b) where = junctions.has(b) ? 'junction' : typeAt(Math.max(0, b - 1))
        else where = explanation.segmentOf[b0] === explanation.segmentOf[b - 1] ? typeAt(b0) : 'junction'
        return { op: s.op, source: s.source, target: s.target, cost: s.cost, category: s.rule?.category ?? null, where }
      })
  }

  /**
   * 構詞搜尋（單獨執行；搜尋引擎則把通道與普通模糊搜尋合併成一次走訪）。
   * @param query 已正規化的查詢（搜尋鍵）
   */
  function search(query: string, { maxDistance = 1, stats }: { maxDistance?: number; stats?: { visitedNodes: number } } = {}): MorphHit[] {
    const prepared = prepare(query, maxDistance)
    if (!prepared) return []
    const local = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    const results = index.searchChannels(seed(prepared).channels, local)
    if (stats) stats.visitedNodes += local.visitedNodes
    return finish(prepared, results, maxDistance)
  }

  /**
   * 說明一次構詞搜尋：各階段的中間結果，給演算法實驗室逐步展示（docs/lab-design.md）。
   * 與 search 走同一套程式，所以 hit 一定等於搜尋對這個詞的結果（測試逐一比對）。
   * 回傳值只含可以結構化複製的資料，∞ 寫成 null，可以從 Web Worker 傳回。
   * @param query 已正規化的查詢（搜尋鍵）
   * @param term 要說明的詞根（省略時只列出命中）
   * @param options.maxDistance 總成本上限（與 search 相同）
   */
  function explain(query: string, term: string | null = null, { maxDistance = 1 }: { maxDistance?: number } = {}) {
    const chars = Array.from(query)
    const params = { maxSteps: spec.maxSteps, minStem: spec.minStem, lemmaSpread: spec.lemmaSpread, maxDistance }
    const prepared = prepare(query, maxDistance)
    if (!prepared) return { query, chars, params, tooShort: true as const, term, reason: term === null ? null : 'short' }
    const walks: NodeVisit[][] = prepared.channels.map(() => [])
    seed(prepared)
    const results = index.searchChannels(prepared.channels.map((ch, c) => ({ query: ch.query, options: { ...ch.options, onNode: (e: NodeVisit) => walks[c].push(e) } })))
    const hits = finish(prepared, results, maxDistance)
    const cutoff = hits.length ? roundCost(hits[0].distance + spec.lemmaSpread) : null
    const finite = (x: number) => (x === Infinity ? null : roundCost(x))
    const rowOf = (row: ArrayLike<number>) => Array.from(row, finite)

    let hit: MorphHit | null = null
    let alignment: Record<string, unknown> | null = null
    /** 找不到 term 的原因 */
    let reason: string | null = null
    if (term !== null) {
      hit = hits.find((h) => h.term === term) ?? null
      if (hit) {
        const x = explainHit(prepared, hit)
        const e = x.explanation
        alignment = {
          query: x.query,
          segments: x.segments.map((s) => ({ type: s.type, form: s.form, length: s.chars.length })),
          junctions: e.junctions,
          distance: e.distance,
          matrix: e.matrix.map((r) => r.map((c) => (c === Infinity ? null : c))),
          path: e.path,
          steps: e.alignment,
        }
      } else if (term === query) reason = 'same'
      else if (Array.from(term).length < spec.minStem) reason = 'short'
      else {
        // 走訪用了相對上限，被截斷的詞可能根本沒走到：只對這個詞、不收緊上限再算一次
        const single = new FuzzyIndex(metric).addAll([[term, null]])
        const alone = single.searchChannels(prepared.channels.map((ch) => ({ query: ch.query, options: { ...ch.options, cutoff: undefined } })))
        reason = alone.flat().length ? 'spread' : 'bound'
      }
    }
    return {
      query,
      chars,
      params,
      tooShort: false as const,
      prefixLevels: prepared.prefixLevels.map((L) => rowOf(L.row)),
      suffixLevels: prepared.suffixLevels.map((L) => rowOf(Float64Array.from(L.row).reverse())),
      merged: {
        P: rowOf(prepared.P.row),
        S: rowOf(prepared.S.row),
        crossingP: prepared.P.pending.map((p) => ({ head: metric.compiled.trieString(p.node), row: rowOf(p.row) })),
        crossingS: prepared.S.pending.map((p) => ({ tail: p.tail.join(''), row: rowOf(p.row) })),
      },
      variants: prepared.variants.map((v) => ({
        kind: v.kind,
        text: v.chars.join(''),
        chars: [...v.chars],
        op: v.op,
        options: v.options ?? null,
        start: v.start,
        prefixed: v.prefixed,
        suffix: v.suffix,
        alt: v.alt ? { options: v.alt.options } : null,
        noBase: v.noBase ?? false,
      })),
      truncated: prepared.truncated,
      candidates: results.map((list) => list.map((r) => ({ term: r.term, distance: r.distance, exit: r.exit ?? null }))),
      walks: walks.map((events) => events.map((e) => ({ ...e, lowerBound: finite(e.lowerBound) }))),
      hits,
      cutoff,
      term,
      hit,
      alignment,
      reason,
    }
  }

  return { search, prepare, seed, openStems, finish, explain, explainHit, notesOf, spec, rootCost, syllableCost, clearCache: () => cache.clear() }
}

/** 超過上限的格子設成 ∞（之後的成本只會增加，它們不可能成為命中的一部分），全是 ∞ 的跨界狀態丟掉。 */
function clip(level: Level, bound: number): void {
  const cut = (row: Float64Array) => {
    for (let x = 0; x < row.length; x++) if (row[x] > bound + EPSILON) row[x] = Infinity
  }
  cut(level.row)
  for (const p of level.pending) cut(p.row)
  level.pending = level.pending.filter((p) => p.row.some((v) => v < Infinity))
}

/** 一種分析的步驟：前綴（由外而內）、包覆單位、後綴（由外而內） */
function stepsOf(a: { prefixes: AffixEntry[]; suffixes: AffixEntry[]; op: MorphStepHit | null }): MorphStepHit[] {
  return [...a.prefixes.map((x) => affixStep('prefix', x)), ...(a.op ? [a.op] : []), ...a.suffixes.map((x) => affixStep('suffix', x))]
}

/** 步驟成本的和 */
function stepCostOf(steps: MorphStepHit[]): number {
  return steps.reduce((x, s) => x + s.cost, 0)
}

/** 步驟的比較鍵（種類與寫法，由外而內） */
function stepsKey(steps: MorphStepHit[]): string {
  return steps.map((s) => `${s.type}:${s.form}`).join('\u0000')
}

function affixStep(type: 'prefix' | 'suffix', a: AffixEntry): MorphStepHit {
  return { type, form: a.form, gloss: a.gloss, cost: a.cost, ...(a.parts ? { parts: a.parts } : {}) }
}

/** 詞幹上的中綴、重疊（單獨的步驟）：form 是中綴，或查詢中的重疊部分。 */
function opStep(type: 'infix' | 'reduplication', form: string, e: { gloss: Gloss; cost: number; parts?: readonly Part[] }): MorphStepHit {
  return { type, form, gloss: e.gloss, cost: e.cost, ...(e.parts ? { parts: e.parts } : {}) }
}

/** 同一格同分時，說明選規格中較前的詞綴或環綴（mergeInto 的 before）。 */
const byRank = (tag: { rank: number }, current: { rank: number } | null) => !current || tag.rank < current.rank

/** 依鍵分組（保留第一次出現的順序）。 */
function groupBy<T, K>(list: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of list) {
    const k = key(item)
    const group = out.get(k)
    if (group) group.push(item)
    else out.set(k, [item])
  }
  return out
}

/**
 * 要求元音開頭的環綴的起點併進原本的起點時的同分規則（morph-grammar.md 2.4）：步驟少的優先，再依規格的順序。
 * 原本的起點若是前綴鏈，tag 是層數（步驟數）；只有一層時，比較的是第一層那一格的前綴。
 * @param first 第一層前綴的狀態（tag 是前綴）
 */
const fewerSteps = (first: Level | undefined) => (tag: Circumfix, current: unknown, x: number, node: number | null): boolean => {
  if (current === null || current === undefined) return true
  if (typeof current !== 'number') return byRank(tag, current as { rank: number })
  if (current > 1) return true
  const affix = (node === null ? first?.tags?.row[x] : first?.tags?.pending.get(node)?.[x]) as { rank: number } | null | undefined
  return !affix || tag.rank < affix.rank
}

/** 同分時比較分析的鍵：步驟數，再來是各步驟在規格中的順序（由小到大排好）。 */
function tieKey(a: { prefixes: AffixEntry[]; suffixes: AffixEntry[]; op: MorphStepHit | null; rank: number | null }): number[] {
  const ranks = [...a.prefixes.map((x) => x.rank), ...a.suffixes.map((x) => x.rank), ...(a.op ? [a.rank ?? Infinity] : [])].sort((x, y) => x - y)
  return [ranks.length, ...ranks]
}

/** 字典序比較 */
function compareKeys(x: number[], y: number[]): number {
  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return x[k] - y[k]
  return x.length - y.length
}
