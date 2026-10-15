/**
 * @file 模糊程度：依查詢長度決定加權編輯距離的門檻，以及構詞搜尋（自動拆解、自動派生）的成本上限。
 */

import type { SearchOptions as FuzzySearchOptions } from '#bcdp'
import type { Fuzziness, FuzzinessLevel } from './types.ts'

/**
 * 模糊程度：依查詢長度 n（code point）決定距離門檻。
 * normalization 一律用 'max'（距離 ÷ 較長字串長度），避免短查詢配到長詞。
 */
export const FUZZINESS: Readonly<Record<Fuzziness, FuzzinessLevel>> = Object.freeze({
  exact: { label: '精確', maxDistance: () => 0, maxNormalized: Infinity, derivedFromAll: false },
  normal: { label: '標準', maxDistance: (n: number) => clamp(0.2 + 0.15 * n, 0.3, 1.6), maxNormalized: 0.3, derivedFromAll: false },
  // 寬鬆：所有模糊命中都當詞根去找自動派生形（標準只用查詢本身與方言變體）
  loose: { label: '寬鬆', maxDistance: (n: number) => clamp(0.5 + 0.25 * n, 0.8, 3), maxNormalized: 0.5, derivedFromAll: true },
})

/** 構詞搜尋的總成本上限：min(LEMMA_MAX_DISTANCE, 模糊程度的門檻 ＋ LEMMA_EXTRA_DISTANCE) */
export const LEMMA_MAX_DISTANCE = 1
export const LEMMA_EXTRA_DISTANCE = 0.6

/** 模糊程度的設定；不認得的名稱（含 undefined）當成標準。 */
export function levelOf(fuzziness: Fuzziness | string | undefined): FuzzinessLevel {
  return fuzziness !== undefined && Object.hasOwn(FUZZINESS, fuzziness) ? FUZZINESS[fuzziness as Fuzziness] : FUZZINESS.normal
}

/**
 * 構詞搜尋（自動拆解、自動派生）的總成本上限：min(1, 該模糊程度的門檻 ＋ 0.6)。
 * 兩個方向用同一個上限，「查 w 拆出 r」與「查 r 派生出 w」才會對稱。
 * @param key 查詢的搜尋鍵
 */
export function lemmaMax(key: string, level: FuzzinessLevel): number {
  return Math.min(LEMMA_MAX_DISTANCE, level.maxDistance(Array.from(key).length) + LEMMA_EXTRA_DISTANCE)
}

/** 這個模糊程度對查詢 key 的詞圖搜尋選項（一般搜尋、相近詞與句型搜尋共用）。 */
export function fuzzyOptions(key: string, level: FuzzinessLevel): FuzzySearchOptions {
  return { maxDistance: level.maxDistance(Array.from(key).length), normalization: 'max', maxNormalized: level.maxNormalized }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
