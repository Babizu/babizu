/**
 * @file 搜尋結果的排序分數：詞條與例句共用同一套規則。
 *
 * 分數是「等效距離」，越小越前面，分兩層：
 *
 * 1. **詞的分數**（`termScore`）：查詢詞以什麼方式命中詞庫中的一個詞。
 *    完全相同 0、跨方言變體 0.1–0.3、開頭相符 0.35 起、自動拆解與自動派生 0.4 ＋ 構詞成本、包含 0.9 起。
 * 2. **記錄的分數**（`recordScore`）：那個詞和這一筆記錄的關係。詞就是記錄的詞形（或在句中出現）時不加；
 *    經由**辭典標註**的派生關係（詞根 posting、例句中辭典列在詞條下的派生詞）時，每一層加 `DERIVATIVE_PENALTY`，
 *    排在詞本身之後、其他命中方式之前。
 *
 * 辭典標註的關係與演算法推定的關係分開計算、分開標示：前者是 kind（`root`：衍生自），
 * 後者是命中方式（`lemma` 自動拆解、`derived` 自動派生）。
 */

/**
 * 命中方式：
 * - fuzzy：加權編輯距離在門檻內（含完全相同、跨方言變體）
 * - prefix：詞庫中的詞以查詢開頭（查 pihi → pihilut）
 * - lemma：自動拆解，查詢去詞綴後的詞幹命中詞庫的詞（查 mudaux → daux；BCDP）
 * - derived：自動派生，詞庫的詞由查詢加上詞綴而來（查 baket → binaket；自動派生圖，見 derivations.js）
 * - substring：詞庫中的詞包含查詢（查 k → 所有含 k 的詞與句子）
 * lemma 與 derived 只在語言設定檔有 `morphology` 時出現。
 */
export const MATCH_TYPES = /** @type {const} */ (['fuzzy', 'prefix', 'lemma', 'derived', 'substring'])
/** @typedef {typeof MATCH_TYPES[number]} MatchType */
export const MATCH_TYPE_RANK = { fuzzy: 0, prefix: 1, lemma: 2, derived: 3, substring: 4 }

/** 詞在記錄中的身分（依重要性排序，見 format.js 的 MATCH_KINDS） */
export const KIND_RANK = { head: 0, alt: 1, variant: 2, root: 3, token: 4 }
/** 記錄在群組中的角色 */
export const ROLE_RANK = { head: 0, item: 0, form: 1, segment: 2, example: 3, '': 4 }

/**
 * 構詞相關命中的基本等效距離：一層詞綴（成本 0.2–0.3）約 0.6–0.7，
 * 排在完全相同、跨方言變體與短的開頭相符之後，包含之前。
 */
export const MORPHOLOGY_BASE_SCORE = 0.4

/** 辭典標註的派生關係每一層的差距：派生詞排在詞本身之後 */
export const DERIVATIVE_PENALTY = 0.1

/** 分數是幾個小數相加（0.4 ＋ 0.2），比較時容許的浮點誤差 */
const EPSILON = 1e-9

/**
 * 命中方式換算成等效距離。
 *
 * 完全相同 0、跨方言變體 0.1–0.3、開頭相符約 0.35 起、包含約 0.9 起，多出來的字元越多分數越高。
 * 這樣「查 pihi 找 pihilut」會排在「拼錯一個字母的 pihik-（0.8）」之前，
 * 而精確與跨方言命中仍然穩居最前面。
 *
 * @param {MatchType} matchType
 * @param {number} distance 模糊命中的距離；構詞命中是構詞成本
 * @param {number} extraLength 詞比查詢多出來的字元數
 */
export function rankScore(matchType, distance, extraLength) {
  if (matchType === 'fuzzy') return distance
  if (matchType === 'lemma' || matchType === 'derived') return MORPHOLOGY_BASE_SCORE + distance
  const base = matchType === 'prefix' ? 0.35 : 0.9
  return base + Math.min(extraLength, 12) * 0.05
}

/**
 * @typedef {{term: string, distance: number, matchType: MatchType, score?: number}} Scored
 */

/**
 * 詞的分數：已經定下的（`score`，例如開頭相符又能自動派生的詞取兩者較好的）優先，否則由命中方式換算。
 * @param {Scored} m
 * @param {string} key 查詢詞
 */
export function termScore(m, key) {
  return m.score ?? rankScore(m.matchType, m.distance, Math.max(0, m.term.length - key.length))
}

/**
 * 記錄的分數：詞的分數，加上經由辭典標註的派生關係的層數。
 * @param {number} score 詞的分數（termScore）
 * @param {number} [depth=0] 經過幾層辭典標註的派生關係（詞就是記錄的詞形或句中的詞時為 0）
 */
export function recordScore(score, depth = 0) {
  return score + depth * DERIVATIVE_PENALTY
}

/**
 * 同一個詞同時有構詞命中 m（自動拆解、自動派生）與原本的命中 prev 時，留下哪一個。
 *
 * - 原本是開頭相符或包含：一律改以構詞命中呈現（附上拆解或派生的說明），分數取兩者較好的。
 *   開頭相符只看字串，BCDP 在模糊程度之內也分析得出來時，說明比「開頭相符」有用，名次也不該因此變差。
 * - 原本是模糊命中：取分數較好的一種；同分時模糊命中優先（直接相符）。
 *   不能只看命中方式：詞根落在模糊門檻內時（查 parazem，razem 的模糊距離 1.2 在門檻 1.25 內），
 *   最好的構詞分析（pa- ＋ razem，0.2）會被較差的模糊命中蓋掉。
 *
 * @template {Scored} T
 * @param {T} m 構詞命中
 * @param {T | undefined} prev
 * @param {string} key 查詢詞
 * @returns {T}
 */
export function mergeMorphMatch(m, prev, key) {
  if (!prev) return m
  const a = termScore(m, key)
  const b = termScore(prev, key)
  if (prev.matchType === 'prefix' || prev.matchType === 'substring') return { ...m, score: Math.min(a, b) }
  return a < b - EPSILON ? m : prev
}

/**
 * 詞條命中的排序：分數，再依命中方式、詞長、命中身分、角色、長度。
 * @param {{score: number, matchType: MatchType, term: string, kind: keyof typeof KIND_RANK, doc: {role: string, text: string, index: number}}} a
 * @param {typeof a} b
 */
export function compareHits(a, b) {
  return (
    a.score - b.score ||
    MATCH_TYPE_RANK[a.matchType] - MATCH_TYPE_RANK[b.matchType] ||
    a.term.length - b.term.length ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (ROLE_RANK[/** @type {keyof typeof ROLE_RANK} */ (a.doc.role)] ?? 9) - (ROLE_RANK[/** @type {keyof typeof ROLE_RANK} */ (b.doc.role)] ?? 9) ||
    a.doc.text.length - b.doc.text.length ||
    a.doc.index - b.doc.index
  )
}

/**
 * 例句命中的排序：分數（各查詢詞相加），再依最弱的命中方式、距離、句長。
 * 與詞條同一套分數；例句沒有角色與命中身分之分。
 * @param {{score: number, matchType: MatchType, distance: number, doc: {text: string, index: number}}} a
 * @param {typeof a} b
 */
export function compareOccurrences(a, b) {
  return (
    a.score - b.score ||
    MATCH_TYPE_RANK[a.matchType] - MATCH_TYPE_RANK[b.matchType] ||
    a.distance - b.distance ||
    a.doc.text.length - b.doc.text.length ||
    a.doc.index - b.doc.index
  )
}
