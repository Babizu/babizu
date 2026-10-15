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
 *
 * ## 模組
 * - morph-context.ts：建立時算好、各階段共用的部分（詞綴 trie、中綴與重疊的用法、詞根成本、快取）
 * - morph-levels.ts：詞綴鏈的各層與環綴兩側（交界狀態的合併）
 * - morph-variants.ts：中綴、重疊的還原變體
 * - morph-prepare.ts：第一步，產生詞幹的搜尋通道（prepare）與相對上限的起點（seed）
 * - morph-open-stems.ts：詞庫外的開放詞幹（虛擬詞根）
 * - morph-trace.ts、morph-finish.ts：第二步，追出詞綴鏈、同分時選說明（finish）
 * - morph-explain.ts：命中的對齊說明與實驗室的逐步說明
 */

import { createContext } from './morph-context.ts'
import { explain, explainHit, notesOf } from './morph-explain.ts'
import { finish } from './morph-finish.ts'
import { openStems } from './morph-open-stems.ts'
import { prepare, seed } from './morph-prepare.ts'
import type { MorphHit, MorphSearchDeps, Prepared, StemResult } from './morph-types.ts'
import type { FuzzyIndex } from './fuzzy-index.ts'

export type {
  AffixEntry,
  Circumfix,
  Level,
  MorphHit,
  MorphSearchDeps,
  MorphStepHit,
  Prepared,
  SoundNote,
  StemChannel,
  StemResult,
  Variant,
} from './morph-types.ts'

export type MorphSearch = ReturnType<typeof createMorphSearch>

/**
 * 建立構詞搜尋器。
 *
 * 詞綴索引在建立時就建好，詞綴鏈也會快取；之後若以 `metric.setRules` 換了方言規則，
 * 要呼叫 clearCache（或重新建立構詞搜尋器）。
 */
export function createMorphSearch(deps: MorphSearchDeps) {
  const ctx = createContext(deps)

  /**
   * 構詞搜尋（單獨執行；搜尋引擎則把通道與普通模糊搜尋合併成一次走訪）。
   * @param query 已正規化的查詢（搜尋鍵）
   */
  function search(query: string, { maxDistance = 1, stats }: { maxDistance?: number; stats?: { visitedNodes: number } } = {}): MorphHit[] {
    const prepared = prepare(ctx, query, maxDistance)
    if (!prepared) return []
    const local = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    const results = ctx.index.searchChannels(seed(ctx, prepared).channels, local)
    if (stats) stats.visitedNodes += local.visitedNodes
    return finish(ctx, prepared, results, maxDistance)
  }

  return {
    search,
    /** 第一步：前綴、後綴的各層與還原變體，產生詞幹的搜尋通道（查詢太短時為 null） */
    prepare: (query: string, maxDistance = 1) => prepare(ctx, query, maxDistance),
    /** 走訪之前給相對上限一個起點（idx：接下來要走訪的詞庫，預設是建立時的詞庫） */
    seed: <T extends Prepared | null>(prepared: T, idx?: FuzzyIndex) => seed(ctx, prepared, idx),
    /** 詞庫外的開放詞幹（虛擬詞根的候選） */
    openStems: (prepared: Prepared, options: { keep: (stem: string) => boolean; bound: number }) => openStems(ctx, prepared, options),
    /** 第二步：整理各通道的結果 */
    finish: (prepared: Prepared, resultsPerChannel: StemResult[][], maxDistance: number) => finish(ctx, prepared, resultsPerChannel, maxDistance),
    explain: (query: string, term: string | null = null, options: { maxDistance?: number } = {}) => explain(ctx, query, term, options),
    explainHit: (prepared: Prepared, hit: MorphHit) => explainHit(ctx, prepared, hit),
    notesOf: (prepared: Prepared, hit: MorphHit) => notesOf(ctx, prepared, hit),
    spec: ctx.spec,
    rootCost: ctx.rootCost,
    syllableCost: ctx.syllableCost,
    clearCache: () => ctx.cache.clear(),
  }
}
