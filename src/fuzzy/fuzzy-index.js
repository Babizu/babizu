/**
 * @file 以 DAWG（詞圖）＋ 動態規劃剪枝，找出詞庫中所有「距離在門檻內」的詞。
 *
 * ## 做法
 * 深度優先走訪詞圖。走到深度 j 的節點，就代表候選字串 Y 的前 j 個字元已確定，
 * 這時算出 DP 的第 j 列。共用前綴的詞共用上層的列，不必重算。
 *
 * 底層結構是 DAWG（見 dawg.js）：它同時合併共同前綴與共同後綴，節點數比 Trie 少很多。
 * 對搜尋演算法而言介面幾乎一樣（取子節點、是否為詞尾、子樹高度），差別有兩點：
 * - 節點會被多個詞共用，所以附帶資料不能掛在節點上。改用完美雜湊：DFS 沿著邊累加
 *   `wordsBefore`，抵達詞尾時就得到這個詞的字典序名次，再用名次索引 payload 陣列。
 * - 同一個節點可能出現在走訪的不同位置（共用後綴）。這不影響正確性：
 *   DP 的列取決於「走到這裡的路徑」，而 DFS 中每條路徑只會走一次。
 *
 * ## 詞尾規則
 * 每個節點最多算兩列（見 dp.js 檔頭）：N_j 假設下一字元不是邊界，F_j 假設是詞尾。
 * - 節點本身是詞尾時，距離取 F_j[N]
 * - 子節點引用第 j 列時，依子節點字元是否為邊界選用 F_j 或 N_j
 * 因此 F_j 只在「本節點是詞尾」或「有邊界字元的子節點」時才需要計算，大多數節點只算一列。
 *
 * ## 剪枝的正確性
 * 所有成本非負，所以沿任何 DP 路徑累積的成本單調不減。一次轉移最多跨越
 * L = 最長規則 target 長度 列，因此任何通往更深列的路徑，最後一個「列 ≤ j」的格子
 * 必落在第 j-L+1 … j 列之內，下一步再離開到第 j 列以下：
 * - 若該格在第 j 列：下一步進入某個子節點 c，來源列是 N_j（c 非邊界）或 F_j（c 是邊界），
 *   成本 ≥ 對應列的最小值
 * - 若該格在第 r 列（r < j）：下一步必須是一條 target 長度 > j-r 的規則，且 target 的
 *   前 j-r 個字元必須等於路徑上已確定的 path[r..j)。成本 ≥ min(第 r 列) + 這類規則的最小權重。
 * 兩者取最小即為子樹下界；下界超過上界時整棵子樹都不可能有符合的詞，可以安全剪掉。
 *
 * 注意：若只看當前第 j 列的最小值（一般 Levenshtein Trie 的做法）在有多字元規則時
 * 是錯的——像 aru→aw 這種規則可以直接從第 j-1 列跳到第 j+1 列，越過第 j 列。
 * 反過來，若不檢查 target 前綴而把前 L 列全部納入，下界又會太鬆（預設規則有
 * say→tshay，L = 5，前 5 層幾乎無法剪枝）。
 * 測試中的「暴力比對性質測試」用來保證剪枝不會漏掉任何結果。
 *
 * ## 詞素交界（構詞搜尋，docs/bcdp.md 第 4–7 節）
 * 構詞搜尋把「前綴鏈 · 詞幹 · 後綴鏈」看成一條底層字串，每一段各走一次（詞綴 trie 或詞庫詞圖），
 * 段與段之間以「交界狀態」銜接（dp.js 檔頭）：
 * - `from`：起點是前一段留下的交界狀態——交界列當作第 0 列，還沒走完的規則 target 由跨界狀態延續
 * - `onJunction`：走到詞尾時回報這一段結束時的交界狀態（前綴鏈、後綴鏈一段一段接下去）
 * - `to`：走到詞尾時與後一段的交界狀態（由反方向算好）耦合，得到整個詞的成本
 * 交界狀態的值都 ≥ 0，所以上面的下界照樣成立；普通搜尋沒有交界。
 * `start`、`end` 兩個向量是沒有跨界狀態的特例。
 *
 * ## 條件檢查（構詞文法的同位詞素條件，docs/morph-grammar.md 2.2、5.1）
 * - `checks`：這一段的路徑（底層的字元）要讀過的條件 DFA。每走一層，每個還沒決定的檢查讀一個字元；
 *   變成死狀態時，它的懲罰加到這條路徑之後的所有成本上（位移 offset，沿路徑累加）。
 *   懲罰都 ≥ 0，所以把 offset 加進下界仍是下界，剪枝照樣正確。
 * - 走到詞尾時：`onJunction` 收到還沒決定的檢查（接下去的詞素繼續讀）；結果的距離則把還沒決定的
 *   檢查當作不成立（條件讀到詞根結尾為止，docs/morph-grammar.md 2.7）。
 * - `to` 可以是多個詞尾耦合對象，各自帶 `checks`：由這一段的結尾往前讀（後綴那側的條件讀詞根結尾），
 *   整個詞的成本取各對象（耦合成本 ＋ 懲罰）的最小值。
 * 沒有任何檢查、只有一個 `to` 時，每一步都與沒有這些功能時相同。
 *
 * ## 實作上的最佳化（結果與最佳化前逐位元相同）
 * - 詞圖的邊標籤預先轉成字元編號（`_edgeCodes`，每個索引、每組規則只算一次），
 *   並預先標出哪些邊是邊界字元，走訪時不再做字串比較。
 * - 路徑上的規則 target 匹配與跨列剪枝改由 `PathMatcher` 逐層維護（見 dp.js 檔頭第 3 點）。
 *   它只依賴路徑、與通道無關，所以每個節點只算一次，所有通道共用。
 * - 列的最小值由 `fillRow` 順便回傳。
 */

import { Dawg } from './dawg.js'
import { advanceCrossing, createCrossing, EDGE_JUNCTION, EDGE_WORD, fillRow, jumpBound, PathMatcher, prepareColumn, roundCost, EPSILON } from './dp.js'
import { resolveNormalization } from './normalization.js'

/**
 * @typedef {object} JunctionState 詞素交界上的 DP 狀態（docs/bcdp.md 第 4 節）
 * @property {Float64Array} row 交界列 R：R[x] ＝ 對齊走到（查詢位置 x, 這個交界）的最小成本
 * @property {Array<{node: number, row: Float64Array}>} pending 跨界表：還沒走完的規則 target
 *   （target trie 的節點）與它起點那一列。交界之後的每個轉移只讀這兩樣，所以它們就是整個「過去」
 */

/**
 * @typedef {object} JunctionEnd 詞尾要耦合的後一段（後綴鏈），由反方向算好、換回正向座標
 * @property {Float64Array | null} row 後一段從查詢位置 x 開始的最小成本
 * @property {Array<{tail: string[], row: Float64Array}>} pending 後一段開頭、跨界規則 target 的後半段
 *   （tail）與它之後那一列：規則 target ＝ 這一段的尾巴 · tail
 * @property {Float64Array | null} [word] 也接受「這一段就是詞尾」：這一段在查詢位置 x 結束時，
 *   詞尾（F 列）之後還要付的成本（通常只有 word[n] ＝ 0；固定交界的變體另有限制）
 * @property {import('./grammar/compile.js').Check[]} [checks] 耦合到這個對象時，由這一段的結尾往前讀的條件檢查
 */

/**
 * @typedef {object} QueryExpansion 查詢展開（詞形還原的預留介面）
 * @property {string} form 展開後的查詢形式，例如去掉前綴後的詞根
 * @property {number} cost 額外加上的成本
 * @property {string} [note] 說明，例如「去前綴 mu-」
 */

/** @typedef {(query: string) => QueryExpansion[]} QueryExpander */

/**
 * @typedef {object} SearchOptions
 * @property {number} [maxDistance=1] 絕對距離上限（含）
 * @property {number} [maxNormalized=Infinity] 正規化分數上限（含）
 * @property {string | Partial<import('./normalization.js').NormalizationStrategy>} [normalization='none'] 用於 score 與 maxNormalized
 * @property {number} [limit=Infinity] 最多回傳幾筆
 * @property {QueryExpander[]} [expanders] 查詢展開器（實驗性，見 expanders.js）
 * @property {(event: NodeVisit) => void} [onNode] 每走訪一個節點回呼一次（視覺化用）
 * @property {ArrayLike<number>} [start] 第 0 列的起點成本（長度 = 查詢長度 + 1）：沒有跨界狀態的 from
 * @property {ArrayLike<number>} [end] 詞尾在查詢各位置結束的附加成本（長度同上）：沒有跨界狀態的 to
 * @property {JunctionState} [from] 起點：前一段留下的交界狀態（位置 0 是詞素交界）
 * @property {number} [startEdge] 位置 0 的種類（dp.js 的 EDGE_*）；預設有 from 時是交界，否則是詞首
 * @property {JunctionEnd | JunctionEnd[]} [to] 詞尾：與後一段的交界狀態耦合；結果的 distance 是整個詞的成本。
 *   可以有多個對象（各自帶條件檢查），取最小值；結果的 exit.to 記著是哪一個（只有一個對象時沒有這個欄位）
 * @property {import('./grammar/compile.js').Check[]} [checks] 沿這一段的路徑讀的條件檢查（見檔頭「條件檢查」）
 * @property {(term: string, state: JunctionState, payloads: unknown[], pending: import('./grammar/compile.js').Check[]) => void} [onJunction]
 *   每走到一個詞尾就回呼一次，附上這一段結束時的交界狀態（複本；已加上路徑上不成立的條件的懲罰），
 *   以及還沒決定的條件檢查（接下去的詞素繼續讀）
 * @property {boolean} [lockBoundary=false] 查詢的邊界字元（空白）完全不能被消耗（詞綴不含空白）
 * @property {SpreadCutoff} [cutoff] 相對上限（可由多個通道共用）：只需要「最佳 ＋ spread」之內的結果時，
 *   上限隨目前找到的最佳結果收緊。最後的最佳一定不大於途中的最佳，所以最佳 ＋ spread 之內的詞一個也不會少
 * @property {(term: string, row: Float64Array, payloads: unknown[]) => void} [onTerminal]
 *   每走到一個詞尾就回呼一次，附上完整的 F 列（row[i] = 查詢前 i 個字元轉成這個詞的成本）
 */

/**
 * @typedef {object} SpreadCutoff 相對上限的共用狀態（走訪時會被改寫）
 * @property {number} best 目前找到的最小距離（初始 Infinity）
 * @property {number} spread 只保留距離不超過「最佳 ＋ spread」的結果
 * @property {(term: string) => boolean} [eligible] 哪些詞算進最佳（呼叫端之後會丟掉的詞不能收緊上限）
 */

/**
 * @typedef {object} NodeVisit
 * @property {string} prefix 此節點代表的前綴
 * @property {number} depth
 * @property {number} node 詞圖中的節點編號（共用後綴時會在不同位置重複出現）
 * @property {number} lowerBound 子樹內任何詞的距離下界
 * @property {number} bound 此子樹允許的絕對距離上界
 * @property {boolean} pruned 是否在此剪枝
 * @property {boolean} terminal 此節點是否為詞尾
 * @property {number | null} distance 若為詞尾，該詞的距離
 * @property {boolean} accepted 若為詞尾，是否符合門檻
 */

/**
 * @typedef {object} SearchResult
 * @property {string} term 詞庫中的詞（已正規化）
 * @property {number} distance 絕對距離
 * @property {number} score 正規化分數（normalization='none' 時等於 distance）
 * @property {unknown[]} payloads 加入詞庫時附帶的資料
 * @property {string} [via] 若經由查詢展開找到，記錄展開說明
 * @property {number} [endAt] 有 to 時，詞在查詢中結束的位置（達到最小值的 x）
 * @property {{kind: 'word' | 'row' | 'pending', x: number, tail: number, to?: number}} [exit] 有 to 時，最小值來自哪裡：
 *   詞尾（word）、交界列（row）、跨界規則（pending，tail 是 to.pending 的序號，x 是後一段開始的位置）
 */

/**
 * @typedef {object} SearchStats
 * @property {number} visitedNodes
 * @property {number} prunedNodes
 * @property {number} computedRows
 */

/**
 * @typedef {object} SerializedIndex
 * @property {string} format
 * @property {number} version
 * @property {import('./dawg.js').SerializedDawg} dawg
 * @property {unknown[][]} payloads 依詞的字典序排列
 */

export const INDEX_FORMAT = 'pazeh-fuzzy-index'
export const INDEX_VERSION = 2

export class FuzzyIndex {
  /**
   * @param {import('./distance.js').WeightedEditDistance} metric
   * @param {{dawg: Dawg, payloads: unknown[][]}} [built] 已建好的詞圖（反序列化時使用）
   */
  constructor(metric, built) {
    this.metric = metric
    /** @type {Map<string, unknown[]> | null} 建構中的詞與附帶資料；凍結後釋放 */
    this._entries = built ? null : new Map()
    /** @type {Dawg | null} */
    this._dawg = built?.dawg ?? null
    /** @type {unknown[][]} 依詞的字典序排列 */
    this._payloads = built?.payloads ?? []
    /** @type {string[] | null} 詞表快取（需要逐詞比對時才展開） */
    this._terms = null
    /** @type {{compiled: object, dawg: Dawg, codes: Int32Array, boundary: Uint8Array} | null} 邊標籤的字元編號（見 _edgeCodes） */
    this._codes = null
    /** @type {PathMatcher | null} 上一次走訪用過、目前沒被借走的路徑匹配器（見 _searchChannels） */
    this._spareMatcher = null
  }

  /** 詞數 */
  get size() {
    return this._entries ? this._entries.size : this.dawg.size
  }

  /** 詞圖（第一次使用時才建立） */
  get dawg() {
    if (!this._dawg) this.freeze()
    return /** @type {Dawg} */ (this._dawg)
  }

  /** 所有詞（字典序）。第一次呼叫時才展開成陣列。 */
  get terms() {
    if (!this._terms) this._terms = this.dawg.words()
    return this._terms
  }

  /** 每個詞的附帶資料，順序與 `terms` 相同 */
  get payloads() {
    this.dawg // 確保已建立
    return this._payloads
  }

  /**
   * 加入一個詞。詞會先經過 metric 的正規化；正規化後為空字串的詞會被忽略。
   * @param {string} term
   * @param {unknown} [payload] 附帶資料（例如資料庫中的記錄編號）
   * @returns {this}
   */
  add(term, payload) {
    const key = this.metric.normalize(term)
    if (key === '') return this
    const entries = this._unfreeze()
    let list = entries.get(key)
    if (!list) entries.set(key, (list = []))
    if (payload !== undefined) list.push(payload)
    return this
  }

  /**
   * 批次加入。
   * @param {Iterable<[string, unknown] | string>} items
   */
  addAll(items) {
    for (const item of items) {
      if (Array.isArray(item)) this.add(item[0], item[1])
      else this.add(item)
    }
    return this
  }

  /**
   * 建立詞圖。加入新詞後會在下一次使用時自動重建，一般不需要自己呼叫。
   */
  freeze() {
    const entries = this._entries ?? new Map()
    const dawg = Dawg.build([...entries.keys()])
    /** @type {unknown[][]} */
    const payloads = new Array(dawg.size)
    for (const [term, list] of entries) payloads[dawg.lookup(term)] = list
    for (let k = 0; k < payloads.length; k++) payloads[k] ??= []
    this._dawg = dawg
    this._payloads = payloads
    this._entries = null
    this._terms = null
    return this
  }

  /**
   * 回到可新增詞的狀態（必要時由詞圖還原）。
   * @returns {Map<string, unknown[]>}
   * @private
   */
  _unfreeze() {
    if (this._entries) return this._entries
    /** @type {Map<string, unknown[]>} */
    const entries = new Map()
    if (this._dawg) this.terms.forEach((term, k) => entries.set(term, this._payloads[k] ?? []))
    this._entries = entries
    this._dawg = null
    this._terms = null
    return entries
  }

  /**
   * 精確查詢（經正規化）。
   * @param {string} term
   * @returns {unknown[] | undefined}
   */
  lookup(term) {
    const index = this.dawg.lookup(this.metric.normalize(term))
    return index === -1 ? undefined : this._payloads[index]
  }

  /**
   * 依詞的字典序名次取得詞與附帶資料。
   * @param {number} id
   */
  entry(id) {
    return { term: this.dawg.wordAt(id), payloads: this._payloads[id] }
  }

  /**
   * 模糊搜尋。
   * @param {string} query
   * @param {SearchOptions} [options]
   * @returns {SearchResult[]} 依 score、distance、詞排序
   *
   * @example
   * index.search('bintul', { maxDistance: 0.5 })
   * // → [{ term: 'bintun', distance: 0.1, score: 0.1, payloads: [...] }, ...]
   */
  search(query, options = {}) {
    return this.searchWithStats(query, options).results
  }

  /**
   * 模糊搜尋，並回傳走訪統計。
   * @param {string} query
   * @param {SearchOptions} [options]
   * @returns {{results: SearchResult[], stats: SearchStats}}
   */
  searchWithStats(query, options = {}) {
    const { limit = Infinity, expanders = [] } = options
    const stats = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    const norm = resolveNormalization(options.normalization ?? 'none')
    const queryLength = this.metric.prepare(query).length

    /** @type {Map<string, SearchResult>} */
    const merged = new Map()
    for (const r of this._searchCore(query, options, stats)) merged.set(r.term, r)

    // 查詢展開：以較低的距離預算搜尋展開形式，加上展開成本後合併（取較小者）
    for (const expand of expanders) {
      for (const { form, cost, note } of expand(query)) {
        const budget = (options.maxDistance ?? 1) - cost
        if (budget < 0) continue
        const sub = this._searchCore(form, { ...options, maxDistance: budget, maxNormalized: Infinity }, stats)
        for (const r of sub) {
          const distance = roundCost(r.distance + cost)
          const score = roundCost(norm.score(distance, queryLength, Array.from(r.term).length))
          if (score > (options.maxNormalized ?? Infinity) + EPSILON) continue
          const prev = merged.get(r.term)
          if (!prev || score < prev.score) {
            merged.set(r.term, { ...r, distance, score, via: note ?? form })
          }
        }
      }
    }

    const results = [...merged.values()].sort(
      (a, b) => a.score - b.score || a.distance - b.distance || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0),
    )
    return { results: Number.isFinite(limit) ? results.slice(0, limit) : results, stats }
  }

  /**
   * 多通道搜尋：一次詞圖走訪同時跑好幾組查詢／邊界條件（例如普通模糊搜尋＋構詞搜尋的各個還原變體）。
   *
   * 每個通道有自己的 DP 列、上限與剪枝；某個通道在一個節點被剪掉，只是它不再往下算，
   * 其他通道照常進行，所有通道都剪掉時才停止往下走。所以每個通道的結果與單獨搜尋完全相同，
   * 但詞圖的走訪、路徑維護、出邊檢查只做一次。通道數沒有上限（每一層記一份存活通道的清單）。
   *
   * 通道的 query 可以是字串（先經過 metric 的正規化），也可以是**已正規化的 code point 陣列**
   * （原樣使用、不再正規化）。構詞搜尋用後者：它的查詢片段取自已正規化的查詢，
   * 再正規化一次可能改變片段（例如截掉頭尾空白），位置就會錯開（docs/bcdp.md 第 11 節）。
   *
   * @param {Array<{query: string | string[], options?: SearchOptions}>} channels
   * @param {SearchStats} [stats] 累加統計（走訪節點數以實際走訪計，不按通道重複計算）
   * @returns {SearchResult[][]} 各通道的結果（未排序）
   */
  searchChannels(channels, stats = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }) {
    return this._searchChannels(
      channels.map((c) => ({ query: c.query, options: c.options ?? {} })),
      stats,
    )
  }

  /**
   * 單一查詢的搜尋主體：就是只有一個通道的 `_searchChannels`。
   * @param {string} query
   * @param {SearchOptions} options
   * @param {SearchStats} stats 累加統計
   * @returns {SearchResult[]}
   * @private
   */
  _searchCore(query, options, stats) {
    return this._searchChannels([{ query, options }], stats)[0]
  }

  /**
   * 搜尋主體：詞圖深度優先走訪 + 逐列 DP + 剪枝（可同時跑多個通道）。
   * @param {Array<{query: string, options: SearchOptions}>} specs
   * @param {SearchStats} stats 累加統計
   * @returns {SearchResult[][]}
   * @private
   */
  _searchChannels(specs, stats) {
    if (specs.length === 0) return []
    const { compiled, costs } = this.metric
    const dawg = this.dawg
    const payloads = this._payloads
    const { codes, boundary } = this._edgeCodes(compiled)

    /** @type {string[]} 目前走訪路徑上的字元（所有通道共用；只在組出結果的詞時使用） */
    const path = []
    /**
     * 路徑上的字元編號、邊界旗標與規則 target 的 trie 狀態（所有通道共用）。
     * 重複使用上一次的（每一層都由上一層重算，不會留下舊狀態）；走訪中的回呼若又搜尋同一個索引，
     * 那一次拿不到這個（已被借走），會另建一個。
     */
    const spare = this._spareMatcher
    const matcher = spare && spare.compiled === compiled ? spare : new PathMatcher(compiled)
    this._spareMatcher = null
    /** 第 r 列（r < 目前深度）是否該用 F 列：看路徑上第 r 個字元是否為邊界 */
    const useF = (/** @type {number} */ r) => matcher.boundary[r] === 1

    /**
     * 查詢端的編譯結果依（查詢、交界、鎖住空白）共用：通道之間只差在起點列。複本共用成本表的快取與
     * 暫存（ColumnContext、ruleMin）；每個節點上一個通道的列算完才換下一個通道，所以暫存不會互相覆寫
     * @type {Map<string, import('./dp.js').QueryPlan>}
     */
    const plans = new Map()
    /** @param {string[]} x @param {Float64Array | null} start @param {boolean} junctions @param {boolean} lockBoundary */
    const planFor = (x, start, junctions, lockBoundary) => {
      const key = `${junctions ? 1 : 0}${lockBoundary ? 1 : 0}${x.join('\u0001')}`
      let base = plans.get(key)
      if (!base) plans.set(key, (base = compiled.compileQuery(x, costs, { start: null, junctions, lockBoundary })))
      return start ? { ...base, start: Float64Array.from(start) } : base
    }

    const channels = specs.map(({ query, options }) => {
      const x = Array.isArray(query) ? query : this.metric.prepare(query)
      const n = x.length
      // start／end 是沒有跨界狀態的 from／to
      const from = options.from ?? (options.start ? { row: Float64Array.from(options.start), pending: [] } : null)
      /** @type {JunctionEnd[] | null} 詞尾耦合的對象（可以有多個，各自帶條件檢查） */
      const to = options.to ? (Array.isArray(options.to) ? options.to : [options.to]) : options.end ? [{ row: Float64Array.from(options.end), pending: [], word: null }] : null
      const vectors = [from?.row, ...(from?.pending ?? []).map((p) => p.row), ...(to ?? []).flatMap((t) => [t.row, t.word, ...t.pending.map((p) => p.row)])]
      for (const vec of vectors) {
        if (vec && vec.length !== n + 1) throw new RangeError(`start／end（交界狀態）的長度必須是查詢長度 + 1（${n + 1}）`)
        // 剪枝的下界依賴「交界成本不小於 0」（docs/bcdp.md 第 7 節）
        if (vec && !Array.prototype.every.call(vec, (c) => c >= 0)) throw new RangeError('start／end（交界狀態）的值必須是非負數或 Infinity')
      }
      // 詞尾耦合的位能：pot[x] ＝ 在查詢位置 x 或之後結束時，至少還要付的耦合成本。對齊的查詢位置只會往後走，
      // 所以子樹的下界可以用 min_x（列[x] ＋ pot[x]）取代列的最小值（docs/bcdp.md 第 7 節）。
      // 允許直接在詞尾結束（to.word[n] ＝ 0）時位能處處是 0，不必計算
      /** @type {Float64Array | null} */
      let pot = null
      if (to) {
        const e = new Float64Array(n + 1).fill(Infinity)
        // 條件檢查的懲罰 ≥ 0，所以各對象的最小值仍是下界
        for (const vec of to.flatMap((t) => [t.row, t.word, ...t.pending.map((p) => p.row)])) {
          if (vec) for (let x = 0; x <= n; x++) if (vec[x] < e[x]) e[x] = vec[x]
        }
        for (let x = n - 1; x >= 0; x--) if (e[x + 1] < e[x]) e[x] = e[x + 1]
        if (e.some((v) => v > 0)) pot = e
      }
      /** @type {import('./dp.js').Crossing[]} 第 j 層的跨界狀態（來自 from.pending，只在淺層） */
      const cross = []
      if (from && from.pending.length) {
        const c0 = createCrossing(from.pending.length)
        from.pending.forEach((p, k) => {
          c0.nodes[k] = p.node
          c0.rows[k] = p.row
          c0.mins[k] = Math.min(...p.row)
        })
        c0.count = from.pending.length
        cross[0] = c0
      }
      /**
       * rowsN[j]、rowsF[j]：路徑上第 j 層的兩種列；minN[j]、minF[j] 為各列最小值。
       * 同一深度的兄弟節點依序走訪，前一個兄弟的子樹走完才會覆寫，所以每層各配置一次即可重複使用。
       * @type {Float64Array[]}
       */
      const rowsN = []
      /** @type {Float64Array[]} rowsF[j] 是 F 列；不需要 F 列時與 rowsN[j] 是同一個陣列 */
      const rowsF = []
      /** @type {Float64Array[]} F 列自己的緩衝（每層一個）：rowsF[j] 指回 rowsN[j] 之後不必重新配置 */
      const bufF = []
      /** @type {number[]} */
      const minN = []
      /** @type {number[]} */
      const minF = []
      const junctions = Boolean(from || to || options.onJunction)
      return {
        n,
        from,
        to,
        startEdge: options.startEdge ?? (from ? EDGE_JUNCTION : EDGE_WORD),
        cross,
        pot,
        /** 詞尾的交界列（算完立刻使用，所以每個通道一個緩衝就夠） */
        rowJ: junctions ? new Float64Array(n + 1) : null,
        /** 跨界耦合：各對象一個（這一段尾巴的 trie 節點, to.pending 的序號）→ 規則 target 編號（-1 表示沒有） */
        coupleTarget: (to ?? []).map(() => new Map()),
        /** 沿路徑讀的條件檢查；ckStates[j]、ckOffset[j]：第 j 層各檢查的 DFA 狀態與累加的懲罰 */
        checks: options.checks?.length ? options.checks : null,
        /** @type {Int32Array[]} */
        ckStates: [],
        /** @type {number[]} */
        ckOffset: [],
        maxDistance: options.maxDistance ?? 1,
        cutoff: options.cutoff ?? null,
        maxNormalized: options.maxNormalized ?? Infinity,
        norm: resolveNormalization(options.normalization ?? 'none'),
        onNode: options.onNode,
        onTerminal: options.onTerminal,
        onJunction: options.onJunction,
        plan: planFor(x, from?.row ?? null, junctions, options.lockBoundary ?? false),
        rowsN,
        rowsF,
        bufF,
        minN,
        minF,
        rowAt: (/** @type {number} */ r) => (useF(r) ? rowsF[r] : rowsN[r]),
        /** 第 r 列的最小值（跨列剪枝 jumpBound 用；每個通道建立一次，不在每個節點配置閉包） */
        minAt: (/** @type {number} */ r) => (useF(r) ? minF[r] : minN[r]),
        /** @type {SearchResult[]} */
        results: [],
      }
    })

    /**
     * 存活的通道：第 j 層的節點只計算 alive[j] 的前 aliveCount[j] 個通道（依通道編號遞增）。
     * 父節點算出下一層的清單後，所有子節點共用；前一個兄弟的子樹走完才會被覆寫，與 DP 的列相同，
     * 所以每層只需一份。以清單取代位元遮罩，通道數不再受 31 個的限制。
     * @type {Int32Array[]}
     */
    const alive = []
    /** @type {number[]} */
    const aliveCount = []
    const aliveAt = (/** @type {number} */ j) => (alive[j] ??= new Int32Array(channels.length))

    /**
     * @param {number} node 詞圖節點編號
     * @param {number} j 深度
     * @param {number} base 這個節點的子樹中，第一個詞的字典序名次
     */
    const visit = (node, j, base) => {
      stats.visitedNodes++
      const isTerminal = dawg.isFinal(node)
      const firstEdge = dawg.firstEdge(node)
      const endEdge = dawg.endEdge(node)

      let hasBoundaryChild = false
      let hasOtherChild = false
      for (let e = firstEdge; e < endEdge; e++) {
        if (boundary[e] === 1) hasBoundaryChild = true
        else hasOtherChild = true
      }

      const current = alive[j]
      const next = aliveAt(j + 1)
      let nextCount = 0
      for (let a = 0; a < aliveCount[j]; a++) {
        const c = current[a]
        const ch = channels[c]
        const { n, plan, rowsN, rowsF, bufF, minN, minF } = ch
        // 跨界狀態：第 j 層由第 j − 1 層沿 Y[j-1] 往下走（只在還有狀態的淺層）。第 0 層的狀態是
        // 「在交界剛好結束」的 target，已經在前一段的交界列算過，所以只用在剪枝的下界
        /** @type {import('./dp.js').Crossing | null} */
        let crossing = null
        if (ch.cross.length) {
          if (j === 0) crossing = ch.cross[0]
          else {
            const prev = ch.cross[j - 1]
            if (prev && prev.count > 0) crossing = advanceCrossing(compiled, prev, matcher.ids[j - 1], (ch.cross[j] ??= createCrossing(ch.cross[0].nodes.length)))
            else if (ch.cross[j]) ch.cross[j].count = 0
          }
        }
        const column = prepareColumn(plan, compiled, matcher, j, ch.rowAt, ch.startEdge, j > 0 ? crossing : null)
        // 條件檢查：第 j 層由第 j − 1 層讀路徑上第 j 個字元（path[j − 1]），死掉的檢查把懲罰加進 offset
        let offset = 0
        if (ch.checks) offset = this._advanceChecks(ch, j, path)

        // N_j：子節點不是邊界字元時使用（fillRow 同時回傳這一列的最小值）
        const rowN = (rowsN[j] ??= new Float64Array(n + 1))
        minN[j] = fillRow(plan, compiled, column, false, rowN)
        if (ch.pot) minN[j] = minWithPotential(rowN, ch.pot)
        stats.computedRows++

        // F_j：只有「本節點是詞尾」或「有邊界字元的子節點」時才會被用到
        let rowF = rowN
        let rowFMin = minN[j]
        if (plan.hasFinal && (isTerminal || hasBoundaryChild)) {
          rowF = bufF[j] ??= new Float64Array(n + 1)
          rowFMin = fillRow(plan, compiled, column, true, rowF)
          if (ch.pot) rowFMin = minWithPotential(rowF, ch.pot)
          stats.computedRows++
        }
        rowsF[j] = rowF
        minF[j] = rowFMin

        // 此子樹允許的絕對距離上界
        let bound = ch.maxDistance
        if (Number.isFinite(ch.maxNormalized) && ch.norm.bound) {
          bound = Math.min(bound, ch.norm.bound(ch.maxNormalized, n, j + dawg.height[node]))
        }
        if (ch.cutoff) bound = Math.min(bound, ch.cutoff.best + ch.cutoff.spread)

        // 詞尾：記錄結果。base 就是這個詞的字典序名次（完美雜湊）
        let distance = null
        let accepted = false
        if (isTerminal) {
          let endAt = n
          // 交界列：這一段在這裡結束、後面接另一個詞素（詞尾與交界兩種規則都適用，X 的切點不在空白旁）
          const rowJ = ch.rowJ
          if (rowJ && (ch.onJunction || ch.to?.some((/** @type {JunctionEnd} */ t) => t.row || t.pending.length))) {
            fillRow(plan, compiled, column, EDGE_JUNCTION, rowJ)
            stats.computedRows++
          }
          if (ch.onJunction) {
            const state = this._junctionState(ch, matcher, j, /** @type {Float64Array} */ (rowJ))
            if (offset > 0) shiftInPlace(state, offset)
            ch.onJunction(path.slice(0, j).join(''), state, payloads[base] ?? [], ch.checks ? this._pendingChecks(ch, j) : [])
          }
          // 結果：還沒決定的條件檢查讀到詞根結尾了，當作不成立（docs/morph-grammar.md 2.7）
          const extra = ch.checks ? offset + this._undecidedPenalty(ch, j) : 0
          /** @type {SearchResult['exit'] | undefined} */
          let exit
          if (ch.to) {
            const coupled = this._couple(ch, matcher, j, rowF, /** @type {Float64Array} */ (rowJ), path)
            distance = roundCost(coupled.cost + extra)
            endAt = coupled.exit.x
            exit = coupled.exit
          } else {
            distance = roundCost(rowF[n] + extra)
          }
          if (ch.onTerminal) ch.onTerminal(path.slice(0, j).join(''), rowF, payloads[base] ?? [])
          if (distance <= ch.maxDistance + EPSILON) {
            const score = roundCost(ch.norm.score(distance, n, j))
            if (score <= ch.maxNormalized + EPSILON) {
              accepted = true
              /** @type {SearchResult} */
              const result = { term: path.slice(0, j).join(''), distance, score, payloads: payloads[base] ?? [] }
              if (ch.to) {
                result.endAt = endAt
                result.exit = exit
              }
              ch.results.push(result)
              if (ch.cutoff && distance < ch.cutoff.best && (!ch.cutoff.eligible || ch.cutoff.eligible(result.term))) ch.cutoff.best = distance
            }
          }
        }

        // 剪枝：子樹內任何詞距離的下界（證明見檔頭）
        let lowerBound = Infinity
        if (hasOtherChild) lowerBound = minN[j]
        if (hasBoundaryChild) lowerBound = Math.min(lowerBound, minF[j])
        // 跨列：第 r 列經由一條更長的規則跳過第 j 列（狀態由 PathMatcher 提供，見 dp.js）；
        // 跨界狀態同理，來源列在前一段
        lowerBound = Math.min(lowerBound, jumpBound(compiled, matcher, j, ch.minAt, crossing))
        // 路徑上已經不成立的條件，懲罰之後一定要付
        if (offset > 0) lowerBound += offset
        const pruned = endEdge > firstEdge && lowerBound > bound + EPSILON

        if (ch.onNode) {
          ch.onNode({
            prefix: path.slice(0, j).join(''),
            depth: j,
            node,
            lowerBound: roundCost(lowerBound),
            bound: roundCost(bound),
            pruned,
            terminal: isTerminal,
            distance,
            accepted,
          })
        }
        if (!pruned) next[nextCount++] = c
      }

      if (nextCount === 0) {
        if (endEdge > firstEdge) stats.prunedNodes++
        return
      }
      aliveCount[j + 1] = nextCount
      for (let e = firstEdge; e < endEdge; e++) {
        path[j] = dawg.label(e)
        matcher.set(j + 1, codes[e])
        visit(dawg.target(e), j + 1, base + dawg.wordsBefore(e))
      }
      // path 超過 j 的部分留著不清：只以 path.slice(0, j) 讀取，下一個兄弟會覆寫 path[j]
    }

    const root = aliveAt(0)
    for (let c = 0; c < channels.length; c++) root[c] = c
    aliveCount[0] = channels.length
    try {
      visit(dawg.root, 0, 0)
    } finally {
      this._spareMatcher = matcher
    }
    return channels.map((c) => c.results)
  }

  /**
   * 這一段在深度 j 的詞尾結束時的交界狀態（複本）：交界列，加上路徑尾端還沒走完的規則 target。
   * 只收本段路徑上的狀態：一條規則至多跨越一個交界（docs/bcdp.md 1.3）。
   * @param {any} ch 通道
   * @param {PathMatcher} matcher
   * @param {number} j
   * @param {Float64Array} rowJ 交界列
   * @returns {JunctionState}
   * @private
   */
  _junctionState(ch, matcher, j, rowJ) {
    const compiled = matcher.compiled
    /** @type {JunctionState['pending']} */
    const pending = []
    const base = j * matcher.cap
    for (let k = 0; k < matcher.counts[j]; k++) {
      const s = matcher.states[base + k]
      if (compiled.trieJump[s] === Infinity) continue // 沒有更長的 target 經過這裡
      pending.push({ node: s, row: Float64Array.from(ch.rowAt(j - compiled.trieDepth[s])) })
    }
    return { row: Float64Array.from(rowJ), pending }
  }

  /**
   * 詞尾與後一段（to）的耦合：整個詞的最小成本。
   * - to.word：這一段就是詞尾：min over x of F 列[x] ＋ word[x]
   * - 不跨界：min over x of 交界列[x] ＋ to.row[x]
   * - 跨界：規則 target ＝ 本段尾巴（路徑上的 trie 狀態 s）· 後一段的開頭（to.pending 的 tail），
   *   X 側 source 占 [i − |source|, i)：本段第 j − depth(s) 列 ＋ 權重 ＋ 後一段從 i 開始的成本
   * @param {any} ch 通道
   * @param {PathMatcher} matcher
   * @param {number} j
   * @param {Float64Array} rowF
   * @param {Float64Array} rowJ
   * @param {string[]} path 目前的路徑（讀耦合對象的條件檢查用）
   * @returns {{cost: number, exit: {kind: 'word' | 'row' | 'pending', x: number, tail: number, to?: number}}}
   * @private
   */
  _couple(ch, matcher, j, rowF, rowJ, path) {
    const targets = /** @type {JunctionEnd[]} */ (ch.to)
    if (targets.length === 1 && !targets[0].checks?.length) return this._coupleOne(ch, matcher, j, rowF, rowJ, targets[0], 0)
    /** @type {{cost: number, exit: {kind: 'word' | 'row' | 'pending', x: number, tail: number, to?: number}}} */
    let best = { cost: Infinity, exit: { kind: 'word', x: -1, tail: -1 } }
    for (let t = 0; t < targets.length; t++) {
      const r = this._coupleOne(ch, matcher, j, rowF, rowJ, targets[t], t)
      if (!(r.cost < best.cost)) continue
      // 由這一段的結尾往前讀的條件檢查（後綴那側的條件讀詞根結尾）：耦合成本已經不比目前的最小值小時不必讀
      const checks = targets[t].checks
      const cost = checks?.length ? r.cost + endPenalty(checks, path, j) : r.cost
      if (cost < best.cost) best = { cost, exit: { ...r.exit, ...(targets.length > 1 ? { to: t } : {}) } }
    }
    return best
  }

  /**
   * 與一個對象的耦合（_couple 的本體）。
   * @param {any} ch
   * @param {PathMatcher} matcher
   * @param {number} j
   * @param {Float64Array} rowF
   * @param {Float64Array} rowJ
   * @param {JunctionEnd} to
   * @param {number} t 對象的序號（跨界 target 的快取各對象一份）
   * @returns {{cost: number, exit: {kind: 'word' | 'row' | 'pending', x: number, tail: number}}}
   * @private
   */
  _coupleOne(ch, matcher, j, rowF, rowJ, to, t) {
    const { n, plan } = ch
    const compiled = matcher.compiled
    let cost = Infinity
    /** @type {{kind: 'word' | 'row' | 'pending', x: number, tail: number}} */
    const exit = { kind: 'word', x: -1, tail: -1 }
    if (to.word) {
      for (let x = 0; x <= n; x++) {
        const v = rowF[x] + to.word[x]
        if (v < cost) {
          cost = v
          exit.x = x
        }
      }
    }
    if (to.row) {
      for (let x = 0; x <= n; x++) {
        const v = rowJ[x] + to.row[x]
        if (v < cost) {
          cost = v
          exit.kind = 'row'
          exit.x = x
        }
      }
    }
    const tails = to.pending
    if (tails.length) {
      const base = j * matcher.cap
      for (let k = 0; k < matcher.counts[j]; k++) {
        const s = matcher.states[base + k]
        if (compiled.trieJump[s] === Infinity) continue
        const fromRow = ch.rowAt(j - compiled.trieDepth[s])
        for (let b = 0; b < tails.length; b++) {
          const key = s * tails.length + b
          const cache = ch.coupleTarget[t]
          let T = cache.get(key)
          if (T === undefined) {
            const node = compiled.trieWalk(s, tails[b].tail)
            T = node === -1 ? -1 : compiled.trieTarget[node]
            cache.set(key, T)
          }
          if (T === -1) continue
          const after = tails[b].row
          for (let p = plan.ruleOff[T]; p < plan.ruleOff[T + 1]; p++) {
            if (plan.ruleFlag[p] !== 0) continue // 跨越交界的只能是沒有位置限制的方言規則
            const i = plan.ruleI[p]
            const v = fromRow[i - plan.ruleSrc[p]] + plan.ruleW[p] + after[i]
            if (v < cost) {
              cost = v
              exit.kind = 'pending'
              exit.x = i
              exit.tail = b
            }
          }
        }
      }
    }
    return { cost, exit }
  }

  /**
   * 條件檢查讀到第 j 層：由第 j − 1 層的狀態讀 path[j − 1]，回傳累加的懲罰（offset）。
   * 已經決定（接受或死狀態）的檢查不再讀；變成死狀態的那一刻加上它的懲罰。
   * @param {any} ch
   * @param {number} j
   * @param {string[]} path
   * @returns {number}
   * @private
   */
  _advanceChecks(ch, j, path) {
    const checks = ch.checks
    const cur = (ch.ckStates[j] ??= new Int32Array(checks.length))
    if (j === 0) {
      for (let k = 0; k < checks.length; k++) cur[k] = checks[k].state
      ch.ckOffset[0] = 0
      return 0
    }
    const prev = ch.ckStates[j - 1]
    let offset = ch.ckOffset[j - 1]
    const c = path[j - 1]
    for (let k = 0; k < checks.length; k++) {
      const { cond, penalty } = checks[k]
      const s = prev[k]
      if (cond.status(s) !== 0) {
        cur[k] = s
        continue
      }
      const next = cond.step(s, c)
      cur[k] = next
      if (cond.status(next) < 0) offset += penalty
    }
    ch.ckOffset[j] = offset
    return offset
  }

  /**
   * 第 j 層還沒決定的條件檢查（複本；接下去的詞素繼續讀）。
   * @param {any} ch
   * @param {number} j
   * @returns {import('./grammar/compile.js').Check[]}
   * @private
   */
  _pendingChecks(ch, j) {
    const out = []
    const states = ch.ckStates[j]
    for (let k = 0; k < ch.checks.length; k++) {
      const { cond, penalty } = ch.checks[k]
      if (cond.status(states[k]) === 0) out.push({ cond, state: states[k], penalty })
    }
    return out
  }

  /**
   * 第 j 層還沒決定的條件檢查的懲罰總和（讀到詞根結尾仍未決定＝不成立）。
   * @param {any} ch
   * @param {number} j
   * @private
   */
  _undecidedPenalty(ch, j) {
    let sum = 0
    const states = ch.ckStates[j]
    for (let k = 0; k < ch.checks.length; k++) if (ch.checks[k].cond.status(states[k]) === 0) sum += ch.checks[k].penalty
    return sum
  }

  /**
   * 詞圖每條邊的字元編號與邊界旗標。字元編號屬於某一組規則（CompiledRules），
   * 所以快取時記下是哪一組；詞圖重建（freeze）或規則替換（setRules）後自動重算。
   * @param {import('./dp.js').CompiledRules} compiled
   * @returns {{codes: Int32Array, boundary: Uint8Array}}
   * @private
   */
  _edgeCodes(compiled) {
    const dawg = this.dawg
    const cached = this._codes
    if (cached && cached.compiled === compiled && cached.dawg === dawg) return cached
    const edges = dawg.edgeLabels.length
    const codes = new Int32Array(edges)
    const boundary = new Uint8Array(edges)
    for (let e = 0; e < edges; e++) {
      codes[e] = compiled.idOf(dawg.label(e))
      boundary[e] = compiled.isBoundaryId(codes[e]) ? 1 : 0
    }
    this._codes = { compiled, dawg, codes, boundary }
    return this._codes
  }

  /**
   * 序列化為可 JSON 化的物件（不含 metric；還原時需提供相同設定的 metric）。
   * @returns {SerializedIndex}
   */
  serialize() {
    return {
      format: INDEX_FORMAT,
      version: INDEX_VERSION,
      dawg: this.dawg.toJSON(),
      payloads: this._payloads,
    }
  }

  /**
   * 由序列化資料還原索引。
   * @param {SerializedIndex} data
   * @param {import('./distance.js').WeightedEditDistance} metric
   */
  static deserialize(data, metric) {
    if (data?.format !== INDEX_FORMAT) {
      throw new TypeError(`不是可辨識的序列化索引（format 應為 ${INDEX_FORMAT}）`)
    }
    if (data.version !== INDEX_VERSION) throw new RangeError(`不支援的序列化版本 ${data.version}`)
    return new FuzzyIndex(metric, { dawg: Dawg.fromJSON(data.dawg), payloads: data.payloads })
  }
}


/**
 * 加上位能的列最小值：min_x（row[x] ＋ pot[x]）。
 * @param {Float64Array} row
 * @param {Float64Array} pot
 */
function minWithPotential(row, pot) {
  let min = Infinity
  for (let x = 0; x < row.length; x++) {
    const v = row[x] + pot[x]
    if (v < min) min = v
  }
  return min
}

/**
 * 交界狀態的每個值加上 c（in place；_junctionState 回傳的是複本）。
 * @param {JunctionState} state
 * @param {number} c
 */
function shiftInPlace(state, c) {
  for (let x = 0; x < state.row.length; x++) state.row[x] += c
  for (const p of state.pending) for (let x = 0; x < p.row.length; x++) p.row[x] += c
}

/**
 * 由這一段的結尾往前讀的條件檢查的懲罰：路徑 path[0..j) 由 j − 1 讀到 0（讀到吸收態就停），
 * 仍未接受的檢查付它的懲罰（死狀態或讀完仍未決定都算不成立）。
 * @param {import('./grammar/compile.js').Check[]} checks
 * @param {string[]} path
 * @param {number} j
 */
function endPenalty(checks, path, j) {
  let sum = 0
  for (const { cond, state, penalty } of checks) {
    let s = state
    for (let k = j - 1; k >= 0 && cond.status(s) === 0; k--) s = cond.step(s, path[k])
    if (cond.status(s) <= 0) sum += penalty
  }
  return sum
}
