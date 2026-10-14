/**
 * @file 測試用：去詞綴＝同一個 BCDP 的字面開放詞幹（morph-search.js 的 openStems），用只有構詞音變的距離函式，
 * 與虛擬詞根走同一條路（virtual-roots.js）。詞幹是詞中原樣的一段，詞綴原樣出現，只容許構詞音變；不需要詞庫。
 */

import {
  createAlternationMetricFromProfile,
  createAnalyzer,
  createMorphSearch,
  createNormalizer,
  FuzzyIndex,
  normalizerOptionsFromProfile,
  notationCharsOf,
} from '../src/index.js'

/**
 * @param {any} morphology 構詞規格（平面清單或構詞文法）；lemmaSpread 沒有寫時放寬到 10，列出所有詞幹
 * @param {Record<string, unknown>} [profile] 語言設定檔的其他欄位（例如 normalizer）
 */
export function openAnalyzer(morphology, profile = {}) {
  const full = /** @type {any} */ ({ format: 'babizu-language-profile', version: 1, ...profile, morphology: { lemmaSpread: 10, ...morphology } })
  // 與搜尋鍵相同的正規化：設定檔的正規化，加上刪除體例符號
  const searchKey = createNormalizer({ ...normalizerOptionsFromProfile(full), removeChars: notationCharsOf(full) })
  const analyzer = createAnalyzer(full.morphology, searchKey)
  const metric = createAlternationMetricFromProfile(full, { normalize: searchKey })
  // 詞庫是空的：開放詞幹都不在詞庫中，也都不是辭典的詞條
  const search = createMorphSearch({ analyzer, metric, index: new FuzzyIndex(metric), isEntry: () => false })
  /**
   * 詞的所有開放詞幹（每個詞幹取成本最低的分析；依成本排序，同分依詞幹）
   * @param {string} w
   * @param {number} [bound] 總成本上限
   * @returns {Array<{stem: string, cost: number, steps: any[]}>}
   */
  const analyze = (w, bound = 1) => {
    const key = searchKey(w)
    const prepared = search.prepare(key, bound)
    if (!prepared) return []
    return search.finish(prepared, search.openStems(prepared, { keep: (s) => s !== key, bound }), bound).map((h) => ({ stem: h.term, cost: h.distance, steps: h.steps }))
  }
  return { analyze, analyzer, search }
}
