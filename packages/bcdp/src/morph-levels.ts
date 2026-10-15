/**
 * @file 構詞搜尋的詞綴鏈：前綴、後綴一層一層合併成交界狀態（levels），與環綴兩側的狀態（sides）。
 */

import { EPSILON } from './dp.ts'
import type { FuzzyIndex } from './fuzzy-index.ts'
import { emptyJunction, isReachable, mergeInto } from './junction.ts'
import { cached } from './morph-context.ts'
import type { AffixEntry, Level, MorphContext } from './morph-types.ts'

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
export function levels(ctx: MorphContext, idx: FuzzyIndex, x: string[], bound: number, tag: string): Level[] {
  const { spec } = ctx
  return cached(ctx, `${tag}|${bound}|${x.join('')}`, () => {
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
    return out
  })
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
export function sides(ctx: MorphContext, idx: FuzzyIndex, x: string[], after: Level, bound: number, tag: string): Map<string, Level> {
  return cached(ctx, `${tag}|${bound}|${x.join('')}`, () => {
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
    return out
  })
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

/** 同一格同分時，說明選規格中較前的詞綴或環綴（mergeInto 的 before）。 */
export const byRank = (tag: { rank: number }, current: { rank: number } | null) => !current || tag.rank < current.rank
