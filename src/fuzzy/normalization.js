/**
 * @file 依字串長度正規化距離的策略。
 *
 * 注意：事後正規化的距離「不滿足三角不等式」（Marzal & Vidal 1993），所以本函式庫
 * 不使用任何依賴度量公理的結構（BK-tree、VP-tree）。正規化只在詞圖搜尋抵達詞尾時
 * 才計算；搜尋途中的剪枝使用各策略提供的 `bound`，把「正規化門檻」換算回
 * 「絕對距離上界」，因此剪枝仍然正確。
 */

/**
 * @typedef {object} NormalizationStrategy
 * @property {string} name
 * @property {(distance: number, queryLength: number, candidateLength: number) => number} score
 *   由絕對距離算出正規化分數
 * @property {((threshold: number, queryLength: number, maxCandidateLength: number) => number) | null} bound
 *   給定正規化門檻，回傳絕對距離的上界。必須對 candidateLength 單調不減，
 *   這樣以子樹最長詞長計算出的上界才對整個子樹成立。
 *   沒有提供時，搜尋只能用絕對距離 maxDistance 剪枝。
 */

/** @type {Readonly<Record<string, NormalizationStrategy>>} */
export const NORMALIZATIONS = Object.freeze({
  /** 不正規化：分數就是絕對距離 */
  none: {
    name: 'none',
    score: (d) => d,
    bound: (t) => t,
  },
  /** 除以兩字串中較長者的長度 */
  max: {
    name: 'max',
    score: (d, n, m) => d / Math.max(n, m, 1),
    bound: (t, n, maxM) => t * Math.max(n, maxM, 1),
  },
  /** 除以兩字串的平均長度：2d / (n + m) */
  sum: {
    name: 'sum',
    score: (d, n, m) => (2 * d) / Math.max(n + m, 1),
    bound: (t, n, maxM) => (t * Math.max(n + maxM, 1)) / 2,
  },
  /** 除以查詢字串長度 */
  query: {
    name: 'query',
    score: (d, n) => d / Math.max(n, 1),
    bound: (t, n) => t * Math.max(n, 1),
  },
})

/**
 * 解析正規化策略：可傳策略名稱或自訂物件。
 * @param {string | Partial<NormalizationStrategy>} strategy
 * @returns {NormalizationStrategy}
 */
export function resolveNormalization(strategy = 'none') {
  if (typeof strategy === 'string') {
    const found = NORMALIZATIONS[strategy]
    if (!found) {
      throw new RangeError(
        `未知的正規化策略：${strategy}（可用：${Object.keys(NORMALIZATIONS).join('、')}）`,
      )
    }
    return found
  }
  if (!strategy || typeof strategy.score !== 'function') {
    throw new TypeError('自訂正規化策略必須提供 score(distance, queryLength, candidateLength)')
  }
  return { name: strategy.name ?? 'custom', score: strategy.score, bound: strategy.bound ?? null }
}
