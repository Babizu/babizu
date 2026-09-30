/**
 * @file 搜尋結果的排序分數：詞條與例句共用同一套規則。
 *
 * 分數是「等效距離」，越小越前面，分兩層：
 *
 * 1. **詞的分數**（`termScore`）：查詢詞以什麼方式命中詞庫中的一個詞。
 *    完全相同 0、跨方言變體 0.1–0.3、開頭相符 0.35 起、自動拆解、自動派生與自動同根 0.4 ＋ 構詞成本、包含 0.9 起。
 * 2. **記錄的分數**（`recordScore`）：那個詞和這一筆記錄的關係。詞就是記錄的詞形（或在句中出現）時不加；
 *    經由**辭典標註**的派生關係（詞根 posting、例句中辭典列在詞條下的派生詞）時，每一層加 `DERIVATIVE_PENALTY`，
 *    排在詞本身之後、其他命中方式之前。
 *
 * 辭典標註的關係與演算法推定的關係分開計算、分開標示：前者是 kind（`root`：衍生自），
 * 後者是命中方式（`lemma` 自動拆解、`derived` 自動派生、`sibling` 自動同根）。
 */

/**
 * 命中方式：
 * - fuzzy：加權編輯距離在門檻內（含完全相同、跨方言變體）
 * - prefix：詞庫中的詞以查詢開頭（查 pihi → pihilut）
 * - lemma：自動拆解，查詢去詞綴後的詞幹命中詞庫的詞（查 mudaux → daux；BCDP）
 * - derived：自動派生，詞庫的詞由查詢加上詞綴而來（查 baket → binaket；自動派生圖，見 derivations.js）
 * - sibling：自動同根，詞庫的詞與查詢推定來自同一個詞庫外的詞根（查 binubuer → mabubuer，共同的虛擬詞根 bubuer）
 * - suffix：詞庫中的詞以查詢結尾（查 kita → mikita）；分數與包含相同，只是分開標示、可以分開篩選
 * - substring：詞庫中的詞包含查詢（查 k → 所有含 k 的詞與句子）
 * lemma、derived、sibling 只在語言設定檔有 `morphology` 時出現。
 */
export const MATCH_TYPES = /** @type {const} */ (['fuzzy', 'prefix', 'lemma', 'derived', 'sibling', 'suffix', 'substring'])
/** @typedef {typeof MATCH_TYPES[number]} MatchType */
export const MATCH_TYPE_RANK = { fuzzy: 0, prefix: 1, lemma: 2, derived: 3, sibling: 4, suffix: 5, substring: 6 }

/**
 * 命中的詞與記錄的關係（依重要性排序）：
 * - head、alt、variant：記錄的詞形、其他寫法、變體；token：出現在句中（format.js 的 MATCH_KINDS）
 * - 辭典標註的構詞關係（DICTIONARY_KINDS，由詞條家族 docs.parent 與 `<` 標註算出）：
 *   root 確定派生（記錄是查詢的下層）、parent 確定拆解（記錄是查詢的上層）、sibling 確定同根（記錄與查詢同一個上層）
 */
export const KIND_RANK = { head: 0, alt: 1, variant: 2, root: 3, parent: 4, sibling: 5, token: 6 }
/** 辭典標註的構詞關係 */
export const DICTIONARY_KINDS = new Set(['root', 'parent', 'sibling'])
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
  if (matchType === 'lemma' || matchType === 'derived' || matchType === 'sibling') return MORPHOLOGY_BASE_SCORE + distance
  // 結尾相符與包含同分（v0.5.6 以前兩者都是包含），只是分開標示
  const base = matchType === 'prefix' ? 0.35 : 0.9
  return base + Math.min(extraLength, 12) * 0.05
}

/**
 * @typedef {{term: string, distance: number, matchType: MatchType, score?: number, others?: Scored[]}} Scored
 *   others：同一個詞被這個命中取代的其他命中（篩掉這個命中方式時依序改用它們，見 mergeMorphMatch、alternativesOf）
 */

/** 部分符合：只看字串 */
const PARTIAL = new Set(['prefix', 'suffix', 'substring'])

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
  return Math.round((score + depth * DERIVATIVE_PENALTY) * 1e9) / 1e9
}

/**
 * 同一個詞同時有構詞命中 m（自動拆解、自動派生、自動同根）與原本的命中 prev 時，留下哪一個。
 *
 * - 原本是開頭相符或包含：一律改以構詞命中呈現（附上拆解或派生的說明），分數取兩者較好的。
 * - 自動同根只補上原本沒有的詞，不取代其他命中（模糊、自動拆解、自動派生）：它經過詞庫中沒有的詞根，
 *   是把握最小的一種；加上它之後，原本的結果一筆都不變。
 *   開頭相符只看字串，BCDP 在模糊程度之內也分析得出來時，說明比「開頭相符」有用，名次也不該因此變差。
 * - 原本是模糊命中：取分數較好的一種；同分時模糊命中優先（直接相符）。
 *   不能只看命中方式：詞根落在模糊門檻內時（查 parazem，razem 的模糊距離 1.2 在門檻 1.25 內），
 *   最好的構詞分析（pa- ＋ razem，0.2）會被較差的模糊命中蓋掉。
 *
 * 被取代的命中記在 `others`：使用者篩掉取代它的命中方式時（例如不看自動派生），改用原本的（開頭相符）。
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
  /** @param {T} winner @param {T} loser @param {Partial<Scored>} [patch] */
  const keep = (winner, loser, patch = {}) => ({ ...winner, ...patch, others: [...(winner.others ?? []), { ...loser, others: undefined }, ...(loser.others ?? [])] })
  if (PARTIAL.has(prev.matchType)) return keep(m, prev, { score: Math.min(a, b) })
  if (m.matchType === 'sibling' || a >= b - EPSILON) return keep(prev, m)
  return keep(m, prev)
}

/**
 * 一個詞的命中與被它取代的命中，依序（先試的在前）。
 * @template {Scored} T
 * @param {T} m
 * @returns {T[]}
 */
export function alternativesOf(m) {
  return [m, .../** @type {T[]} */ (m.others ?? [])]
}

/**
 * 搜尋方法（介面上可以個別顯示或排除）：
 * - 拼寫：exact 完全相符、fuzzy 相近拼寫
 * - 部分符合：prefix 開頭、suffix 結尾、substring 包含
 * - 確定（辭典標註）：dictLemma 拆解、dictDerived 派生、dictSibling 同根
 * - 自動（演算法推定）：lemma 拆解、derived 派生、sibling 同根
 */
export const SEARCH_METHODS = /** @type {const} */ (['exact', 'fuzzy', 'prefix', 'suffix', 'substring', 'dictLemma', 'dictDerived', 'dictSibling', 'lemma', 'derived', 'sibling'])
/** @typedef {typeof SEARCH_METHODS[number]} SearchMethod */

/**
 * 一個命中屬於哪一種搜尋方法。經過好幾種關係時取把握最小的一種：自動 ＞ 部分符合 ＞ 確定 ＞ 拼寫
 * （查 mudaux 自動拆解到 daux，再列出辭典標註的 daux 的派生詞：算自動拆解，不看自動的就不該出現）。
 * @param {{matchType: MatchType, distance: number, kind?: string}} hit
 * @returns {SearchMethod}
 */
export function methodOf(hit) {
  if (hit.matchType === 'lemma' || hit.matchType === 'derived' || hit.matchType === 'sibling') return hit.matchType
  if (PARTIAL.has(hit.matchType)) return /** @type {SearchMethod} */ (hit.matchType)
  if (hit.kind === 'root') return 'dictDerived'
  if (hit.kind === 'parent') return 'dictLemma'
  if (hit.kind === 'sibling') return 'dictSibling'
  return hit.distance > 0 ? 'fuzzy' : 'exact'
}

/**
 * 同一筆記錄（詞條或例句）有好幾個命中時，新的命中 hit 是否取代原本的 prev。
 * 自動同根只用在沒有其他命中的記錄上（與 mergeMorphMatch 同一個原則：它不取代其他命中）；
 * 其他情形依 compare（詞條用 compareHits，例句比分數）。
 * @template {{matchType: MatchType}} H
 * @param {H} hit
 * @param {H | undefined} prev
 * @param {(a: H, b: H) => number} compare
 */
export function replacesRecordHit(hit, prev, compare) {
  if (!prev) return true
  const a = hit.matchType === 'sibling'
  const b = prev.matchType === 'sibling'
  if (a !== b) return b
  return compare(hit, prev) < 0
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
