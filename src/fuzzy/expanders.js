/**
 * @file 查詢展開器：為「去詞綴／詞形還原（lemmatization）」保留的擴充點。
 *
 * 展開器是一個函式 `(query) => [{ form, cost, note }]`：把查詢改寫成其他可能的形式，
 * 並為每個改寫加上成本。`FuzzyIndex.search` 會對每個展開形式再搜尋一次，
 * 距離加上展開成本後與原查詢的結果合併。
 *
 * 這讓「查 minudaux 也能找到詞根 daux-」這類需求可以逐步加入，而不必改動
 * 距離演算法或詞圖。長期而言可以換成加權有限狀態轉錄器（WFST）：
 * 語音規則轉錄器 E ∘ 詞形還原轉錄器 L，一次組合完成（見 docs/fuzzy-search.md）。
 *
 * ⚠ 本檔的詞綴清單只是示範，**不是**語言學上完整或正確的巴宰語構詞分析，預設不啟用。
 */

/**
 * @typedef {object} AffixStripperOptions
 * @property {string[]} [prefixes] 可剝除的前綴（不含連字號）
 * @property {string[]} [suffixes] 可剝除的後綴
 * @property {string[]} [infixes] 可剝除的中綴（插在第一個輔音之後）
 * @property {number} [cost=0.3] 每剝除一個詞綴的成本
 * @property {number} [minStemLength=3] 剝除後詞幹的最短長度
 */

/**
 * 建立一個簡單的詞綴剝除展開器（實驗性）。
 * @param {AffixStripperOptions} [options]
 * @returns {import('./fuzzy-index.js').QueryExpander}
 *
 * @example
 * const expand = createAffixStripper({ prefixes: ['mu'], cost: 0.3 })
 * expand('mudaux') // → [{ form: 'daux', cost: 0.3, note: '去前綴 mu-' }]
 */
export function createAffixStripper(options = {}) {
  const { prefixes = [], suffixes = [], infixes = [], cost = 0.3, minStemLength = 3 } = options

  return function expand(query) {
    const q = query.trim().toLowerCase()
    /** @type {import('./fuzzy-index.js').QueryExpansion[]} */
    const out = []
    const long = (/** @type {string} */ s) => Array.from(s).length >= minStemLength

    for (const p of prefixes) {
      if (q.startsWith(p) && long(q.slice(p.length))) {
        out.push({ form: q.slice(p.length), cost, note: `去前綴 ${p}-` })
      }
    }
    for (const s of suffixes) {
      if (q.endsWith(s) && long(q.slice(0, q.length - s.length))) {
        out.push({ form: q.slice(0, q.length - s.length), cost, note: `去後綴 -${s}` })
      }
    }
    for (const inf of infixes) {
      // 中綴插在第一個輔音之後：C<inf>VC… → CVC…
      const m = /^([^aeiouéə])(.*)$/u.exec(q)
      if (m && m[2].startsWith(inf) && long(m[1] + m[2].slice(inf.length))) {
        out.push({ form: m[1] + m[2].slice(inf.length), cost, note: `去中綴 <${inf}>` })
      }
    }
    return out
  }
}
