/**
 * @file 虛擬詞根：詞庫中沒有的詞根（docs/bcdp.md 10.5）。
 *
 * 詞根不在詞庫中時，在詞圖上走訪找不到它：b<in>ubuer 與 ma-bubuer 共同的詞根 bubuer 不是任何記錄的詞形。
 * 同一個 BCDP 的交界列直接給出「字面的開放詞幹」（morph-search.js 的 openStems）；這裡決定哪些開放詞幹算虛擬詞根：
 * - **字面**：詞幹是詞中原樣的一段，詞綴也必須原樣出現，只容許構詞音變（用只有構詞音變的距離函式，
 *   profile.js 的 createAlternationMetricFromProfile）。不在詞庫裡的部分不能再加模糊，否則會發明詞根；
 * - **長度與形狀的代價**（virtualRootCost）：詞庫中的詞根只要指出是哪一個，詞庫外的要逐字寫出來，所以越長越貴；
 *   再加詞根音節數的成本。分數（成本 ＋ 代價）比詞庫中最好的詞根便宜才成立，取分數最低的（同分全收）；
 * - **形狀像一個詞根**（isVirtualRootShape）：至少兩個元音、比 minStem 長，太短的詞幹容易巧合相同。
 */

import { EPSILON, roundCost } from './dp.ts'
import { rootCostOf } from './morphology.js'

/** @typedef {ReturnType<typeof import('./morph-search.js').createMorphSearch>} MorphSearch */

/** BCDP 對一個詞求詞根（詞庫中的詞根與虛擬詞根）時的總成本上限 */
export const DERIVATION_MAX_COST = 1

/**
 * 一個分析的音變（成本扣掉步驟成本與詞根音節數的成本）
 * @param {{cost: number, steps: Array<{cost: number}>}} a
 * @param {number} [rootCost] 詞根依音節數的成本（rootSyllableCost；不是音變）
 */
export const soundOf = (a, rootCost = 0) => Math.max(0, roundCost(a.cost - a.steps.reduce((x, s) => x + s.cost, 0) - rootCost))

/**
 * 經過虛擬詞根的代價（長度懲罰）：詞庫中沒有這個詞根，要逐字寫出來，每個字元 `virtualRootLengthCost`；
 * 語言設定檔有 rootSyllableCost 時另加音節數的成本（虛擬詞根不是辭典的詞條，用 other）。
 * 每個用到它的詞各付一次（不在共用的詞之間分攤）。
 * 建置時虛擬詞根的分析加上它仍比詞庫中最好的詞根便宜才成立；查詢時經過虛擬詞根的命中加上一次
 * （查詢 → 虛擬詞根 → 詞，只算一次）。
 * @param {string} stem
 * @param {{virtualRootLengthCost: number, rootSyllableCost: {entry: readonly number[], other: readonly number[]}, vowels: string}} spec 構詞規格（分析器的 spec）
 */
export function virtualRootCost(stem, spec) {
  return roundCost(spec.virtualRootLengthCost * Array.from(stem).length + rootCostOf(spec)(stem, false))
}

/**
 * 詞幹的形狀像不像一個詞根（虛擬詞根的條件）：比 minStem 長，而且至少兩個元音。
 * 巴宰語 karaw、kuraw、paraw 都拆得出 raw，但那只是巧合相同的一個音節。
 * @param {string} stem
 * @param {{minStem: number, vowels: string}} spec 構詞規格（分析器的 spec；vowels 是元音字母）
 */
export function isVirtualRootShape(stem, spec) {
  const chars = Array.from(stem)
  return chars.length > spec.minStem && chars.filter((c) => spec.vowels.includes(c)).length >= 2
}

/**
 * 詞 w 在詞庫中最好的詞根的成本，也就是自動派生圖上 w 的詞庫詞根邊的成本：BCDP 最好的命中（含詞根不比詞短的）
 * 若有詞根比詞短的與它同分，就是那個成本；否則 w 沒有詞庫詞根的邊，是 Infinity（例如最好的命中是同樣長的 'a'ata，
 * 而不是 ma'ata 的詞根）。虛擬詞根要比它便宜才成立（virtualRoots 的 lexiconBest）。
 * 建置與查詢共用這個定義，詞庫中的詞在兩端拆出的虛擬詞根才會相同（查詢端若取所有命中的最低成本，
 * 同樣長的相近詞會把虛擬詞根擋掉）。
 * @param {string} w
 * @param {Array<{term: string, distance: number}>} hits BCDP 的全部命中（finish 的結果）
 */
export function lexicalEdgeCost(w, hits) {
  const length = Array.from(w).length
  let best = Infinity
  let edge = Infinity
  for (const h of hits) {
    best = Math.min(best, h.distance)
    if (Array.from(h.term).length < length) edge = Math.min(edge, h.distance)
  }
  return edge <= best + EPSILON ? roundCost(edge) : Infinity
}

/**
 * 一個詞的虛擬詞根（條件見檔頭）：同一個 BCDP 的字面開放詞幹（open.openStems），詞綴必須原樣出現（open 只有構詞音變），
 * 詞根比詞短、不在詞庫中、形狀像詞根；分數（成本 ＋ virtualRootCost）比詞庫中最好的詞根（lexiconBest）便宜的，
 * 取分數最低的（同分全收）。成本是步驟成本加上構詞音變（BCDP 的成本），不含 virtualRootCost。
 * @param {string} w
 * @param {MorphSearch} open 虛擬詞根用的構詞搜尋：只有構詞音變的距離函式上的 BCDP
 * @param {import('./fuzzy-index.js').FuzzyIndex} index 詞庫
 * @param {number} lexiconBest BCDP 在詞庫中最好的詞根的成本（沒有時 Infinity）
 * @returns {Array<{stem: string, cost: number, steps: import('./morph-search.js').MorphStepHit[], notes: ReturnType<MorphSearch['notesOf']>}>}
 *   notes 是構詞音變的說明（成本 ＝ 步驟成本 ＋ notes 的成本）
 */
export function virtualRoots(w, open, index, lexiconBest) {
  if (w.includes(' ')) return []
  const spec = open.spec
  const length = Array.from(w).length
  // 詞根至少 minStem ＋ 1 個字元（形狀），所以成本超過這個上限的分析分數不可能比詞庫的好
  const bound = Math.min(DERIVATION_MAX_COST, lexiconBest - spec.virtualRootLengthCost * (spec.minStem + 1))
  if (bound < 0) return []
  const prepared = open.prepare(w, DERIVATION_MAX_COST)
  if (!prepared) return []
  const keep = (/** @type {string} */ v) => Array.from(v).length < length && index.dawg.lookup(v) === -1 && isVirtualRootShape(v, spec)
  const results = open.openStems(prepared, { keep, bound })
  /** @type {Map<string, number>} 詞幹 → 分數 */
  const score = new Map()
  for (const list of results) for (const r of list) score.set(r.term, Math.min(score.get(r.term) ?? Infinity, r.distance + virtualRootCost(r.term, spec)))
  const ok = [...score].filter(([, x]) => x < lexiconBest - EPSILON)
  if (ok.length === 0) return []
  const min = Math.min(...ok.map(([, x]) => x))
  const chosen = new Set(ok.filter(([, x]) => x <= min + EPSILON).map(([v]) => v))
  // 說明：每個選到的詞根取成本最低的分析，同分依 finish 的規則選一種拆法
  return open
    .finish(
      prepared,
      results.map((list) => list.filter((r) => chosen.has(r.term))),
      DERIVATION_MAX_COST,
    )
    .filter((h) => chosen.has(h.term))
    // finish 的成本含詞根音節數的成本（虛擬詞根用 other）；它算在 virtualRootCost 裡，分析的成本只有步驟與音變
    // （自動派生圖、拆解表的 rootCostOf 對虛擬詞根是 0，音變＝成本 − 步驟）
    .map((h) => ({ stem: h.term, cost: roundCost(h.distance - (h.rootCost ?? 0)), steps: h.steps, notes: open.notesOf(prepared, h) }))
}

