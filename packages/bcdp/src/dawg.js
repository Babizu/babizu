/**
 * @file 有向無環詞圖（DAWG，又稱最小化無環有限狀態自動機 MA-FSA）。
 *
 * Trie 只合併共同「前綴」；DAWG 進一步合併共同「後綴」。巴宰–噶哈巫語有大量共同詞尾
 * （-an、-en、-ay、-ən…），合併後節點數可以少一半以上，序列化檔案也跟著變小。
 *
 * ## 建構
 * 採 Daciuk et al. (2000) 的漸進式最小化演算法：詞必須依序（code point 字典序）加入，
 * 每加入一個詞就把「上一個詞不再需要的尾段」最小化——若已登記過等價狀態就直接共用，
 * 否則登記起來。等價的定義是「是否為詞尾」加上「所有出邊（字元 → 目標節點）」完全相同。
 * 因為子節點一定比父節點先登記，節點編號天然是拓撲序（子 < 父），
 * 之後計算子樹資訊只要依編號遞增掃一遍即可。
 *
 * ## 詞的編號（完美雜湊）
 * DAWG 的節點會被多個詞共用，因此「附帶資料」不能掛在節點上。
 * 每條邊記錄「在這條邊之前有幾個詞」，沿著詞走一遍把這些數字加起來，
 * 就得到該詞在字典序中的名次（0 起算），用它去索引 payload 陣列。
 * 這是 MA-FSA 的標準做法，等於一個完美雜湊函式。
 *
 * ## 記憶體布局
 * 以 CSR（compressed sparse row）存圖：
 * - `edgeStart[node]`…`edgeStart[node + 1]` 是該節點的出邊範圍
 * - `edgeLabels` 是所有邊的字元（每邊一個 code point）
 * - `edgeTarget[k]`、`edgeWordsBefore[k]` 是第 k 條邊的目標與詞數前綴和
 * 另有每個節點的 `final`、`wordCount`（子樹詞數）、`height`（子樹最長詞還有幾個字元）。
 */

/**
 * 依 code point 比較兩個字串（JS 預設的字串比較是依 UTF-16 code unit，
 * 對 BMP 以外的字元順序會和邊的字元順序不一致）。
 * @param {string[]} a
 * @param {string[]} b
 */
function compareChars(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = /** @type {number} */ (a[i].codePointAt(0))
    const y = /** @type {number} */ (b[i].codePointAt(0))
    if (x !== y) return x - y
  }
  return a.length - b.length
}

export class Dawg {
  /**
   * 通常不直接呼叫，請用 `Dawg.build()` 或 `Dawg.fromJSON()`。
   * @param {{root: number, edgeStart: Int32Array, edgeLabels: string[], edgeTarget: Int32Array, final: Uint8Array}} parts
   */
  constructor({ root, edgeStart, edgeLabels, edgeTarget, final }) {
    this.root = root
    this.edgeStart = edgeStart
    this.edgeLabels = edgeLabels
    this.edgeTarget = edgeTarget
    this.final = final
    this.nodeCount = final.length
    this.edgeCount = edgeTarget.length
    this._computeCounts()
  }

  /**
   * 由一組詞建立 DAWG。
   * @param {string[]} words 會自行排序與去重
   * @returns {Dawg}
   */
  static build(words) {
    const sorted = [...new Set(words)]
      .map((word) => ({ word, chars: Array.from(word) }))
      .sort((a, b) => compareChars(a.chars, b.chars))

    /** 建構期間的可變狀態 */
    const makeState = () => ({ children: /** @type {Map<string, any>} */ (new Map()), final: false, id: -1 })
    const root = makeState()
    /** 等價狀態登記表：簽章 → 狀態 */
    const register = new Map()
    /** 已登記（不可再變動）的狀態，順序即節點編號 */
    const frozen = []

    /**
     * 等價狀態的簽章：是否為詞尾 ＋ 每條出邊的（字元碼位, 目標節點編號）。
     * 字元一律寫成碼位數字並加分隔符號，任何字元都不會讓兩個不同的狀態撞號。
     * @param {any} state
     */
    const signatureOf = (state) => {
      let key = state.final ? '1' : '0'
      for (const [ch, child] of state.children) key += `|${ch.codePointAt(0)}>${child.id}`
      return key
    }
    /** @param {any} state */
    const freeze = (state) => {
      const key = signatureOf(state)
      const existing = register.get(key)
      if (existing) return existing
      state.id = frozen.length
      frozen.push(state)
      register.set(key, state)
      return state
    }

    /** 上一個詞的路徑（path[i] 是吃掉前 i 個字元後的狀態） */
    let path = [root]
    /** @type {string[]} */
    let lastChars = []

    for (const { chars } of sorted) {
      let common = 0
      while (common < chars.length && common < lastChars.length && chars[common] === lastChars[common]) common++

      // 上一個詞在 common 之後的尾段不會再變動，由深到淺最小化
      for (let i = path.length - 1; i > common; i--) {
        const child = freeze(path[i])
        path[i - 1].children.set(lastChars[i - 1], child)
      }

      let node = path[common]
      for (let i = common; i < chars.length; i++) {
        const child = makeState()
        node.children.set(chars[i], child)
        node = child
        path[i + 1] = child
      }
      node.final = true
      path.length = chars.length + 1
      lastChars = chars
    }

    // 收尾：最小化最後一個詞的整條路徑，再登記根節點
    for (let i = path.length - 1; i > 0; i--) {
      const child = freeze(path[i])
      path[i - 1].children.set(lastChars[i - 1], child)
    }
    const rootState = freeze(root)

    // 攤平成 CSR 陣列
    const nodeCount = frozen.length
    const edgeStart = new Int32Array(nodeCount + 1)
    for (let id = 0; id < nodeCount; id++) edgeStart[id + 1] = edgeStart[id] + frozen[id].children.size
    const edgeCount = edgeStart[nodeCount]
    const edgeLabels = new Array(edgeCount)
    const edgeTarget = new Int32Array(edgeCount)
    const final = new Uint8Array(nodeCount)
    for (let id = 0; id < nodeCount; id++) {
      const state = frozen[id]
      final[id] = state.final ? 1 : 0
      let k = edgeStart[id]
      // 輸入已排序，Map 的插入順序就是字元順序
      for (const [ch, child] of state.children) {
        edgeLabels[k] = ch
        edgeTarget[k] = child.id
        k++
      }
    }

    return new Dawg({ root: rootState.id, edgeStart, edgeLabels, edgeTarget, final })
  }

  /**
   * 計算每個節點的子樹詞數與高度，以及每條邊的「之前有幾個詞」。
   * 節點編號是拓撲序（子 < 父），所以遞增掃一遍就好。
   * @private
   */
  _computeCounts() {
    const { nodeCount, edgeStart, edgeTarget, final } = this
    const wordCount = new Int32Array(nodeCount)
    const height = new Int32Array(nodeCount)
    const edgeWordsBefore = new Int32Array(this.edgeCount)
    for (let node = 0; node < nodeCount; node++) {
      let count = final[node] ? 1 : 0
      let maxHeight = 0
      for (let k = edgeStart[node]; k < edgeStart[node + 1]; k++) {
        edgeWordsBefore[k] = count
        const target = edgeTarget[k]
        count += wordCount[target]
        maxHeight = Math.max(maxHeight, height[target] + 1)
      }
      wordCount[node] = count
      height[node] = maxHeight
    }
    this.wordCount = wordCount
    this.height = height
    this.edgeWordsBefore = edgeWordsBefore
  }

  /** 詞的總數 */
  get size() {
    return this.wordCount[this.root]
  }

  /** 第 node 個節點的第一條邊 @param {number} node */
  firstEdge(node) {
    return this.edgeStart[node]
  }

  /** 第 node 個節點的最後一條邊（不含）@param {number} node */
  endEdge(node) {
    return this.edgeStart[node + 1]
  }

  /** @param {number} edge */
  label(edge) {
    return this.edgeLabels[edge]
  }

  /** @param {number} edge */
  target(edge) {
    return this.edgeTarget[edge]
  }

  /** 這條邊之前（字典序）有幾個詞 @param {number} edge */
  wordsBefore(edge) {
    return this.edgeWordsBefore[edge]
  }

  /** @param {number} node */
  isFinal(node) {
    return this.final[node] === 1
  }

  /**
   * 找出節點上標籤為 ch 的邊（邊依字元排序，用二分搜尋）。
   * @param {number} node
   * @param {string} ch
   * @returns {number} 邊編號，找不到為 -1
   */
  findEdge(node, ch) {
    let lo = this.edgeStart[node]
    let hi = this.edgeStart[node + 1] - 1
    const code = /** @type {number} */ (ch.codePointAt(0))
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const midCode = /** @type {number} */ (this.edgeLabels[mid].codePointAt(0))
      if (midCode === code) return mid
      if (midCode < code) lo = mid + 1
      else hi = mid - 1
    }
    return -1
  }

  /**
   * 詞 → 字典序名次（完美雜湊）。
   * @param {string} word
   * @returns {number} 名次（0 起算）；不存在為 -1
   */
  lookup(word) {
    let node = this.root
    let rank = 0
    for (const ch of word) {
      const edge = this.findEdge(node, ch)
      if (edge === -1) return -1
      rank += this.edgeWordsBefore[edge]
      node = this.edgeTarget[edge]
    }
    return this.final[node] ? rank : -1
  }

  /**
   * 字典序名次 → 詞（lookup 的反函式）。
   * @param {number} index
   * @returns {string | null}
   */
  wordAt(index) {
    if (index < 0 || index >= this.size) return null
    let node = this.root
    let rank = index
    let word = ''
    for (;;) {
      if (this.final[node]) {
        if (rank === 0) return word
        rank -= 1
      }
      let moved = false
      for (let k = this.edgeStart[node]; k < this.edgeStart[node + 1]; k++) {
        const target = this.edgeTarget[k]
        const count = this.wordCount[target]
        if (rank < count) {
          word += this.edgeLabels[k]
          node = target
          moved = true
          break
        }
        rank -= count
      }
      if (!moved) return null
    }
  }

  /**
   * 依字典序列出所有詞。
   * @returns {string[]}
   */
  words() {
    /** @type {string[]} */
    const out = []
    /** @type {string[]} */
    const path = []
    /** @param {number} node */
    const walk = (node) => {
      if (this.final[node]) out.push(path.join(''))
      for (let k = this.edgeStart[node]; k < this.edgeStart[node + 1]; k++) {
        path.push(this.edgeLabels[k])
        walk(this.edgeTarget[k])
        path.pop()
      }
    }
    walk(this.root)
    return out
  }

  /**
   * 可 JSON 化的表示。`wordCount`、`height`、`edgeWordsBefore` 都能重算，不必存。
   *
   * 編碼選擇（以實際辭典量測，gzip 後）：
   * - 出邊數（0–30 的小數字）比 CSR 的絕對起點省很多：34 KB → 4 KB
   * - 目標節點存「本節點編號 − 目標編號」：子節點一定比父節點早登記，差值中位數只有 7，
   *   比絕對編號省：47 KB → 30 KB
   */
  toJSON() {
    const degrees = new Array(this.nodeCount)
    for (let node = 0; node < this.nodeCount; node++) degrees[node] = this.edgeStart[node + 1] - this.edgeStart[node]
    const targetDeltas = new Array(this.edgeCount)
    for (let node = 0; node < this.nodeCount; node++) {
      for (let k = this.edgeStart[node]; k < this.edgeStart[node + 1]; k++) targetDeltas[k] = node - this.edgeTarget[k]
    }
    return {
      format: DAWG_FORMAT,
      version: DAWG_VERSION,
      root: this.root,
      nodeCount: this.nodeCount,
      labels: this.edgeLabels.join(''),
      degrees,
      targetDeltas,
      finals: finalsToDelta(this.final),
    }
  }

  /**
   * @param {SerializedDawg} data
   * @returns {Dawg}
   */
  static fromJSON(data) {
    if (data?.format !== DAWG_FORMAT) {
      throw new TypeError(`不是可辨識的序列化 DAWG（format 應為 ${DAWG_FORMAT}）`)
    }
    if (data.version !== DAWG_VERSION) throw new RangeError(`不支援的序列化版本 ${data.version}`)
    const final = new Uint8Array(data.nodeCount)
    let node = 0
    data.finals.forEach((delta, k) => {
      node = k === 0 ? delta : node + delta
      final[node] = 1
    })
    const labels = Array.from(data.labels)
    if (labels.length !== data.targetDeltas.length) {
      throw new RangeError(`序列化資料損毀：邊標籤 ${labels.length} 個，目標 ${data.targetDeltas.length} 個`)
    }
    const edgeStart = new Int32Array(data.nodeCount + 1)
    for (let node = 0; node < data.nodeCount; node++) edgeStart[node + 1] = edgeStart[node] + data.degrees[node]
    const edgeTarget = new Int32Array(labels.length)
    for (let node = 0; node < data.nodeCount; node++) {
      for (let k = edgeStart[node]; k < edgeStart[node + 1]; k++) edgeTarget[k] = node - data.targetDeltas[k]
    }
    return new Dawg({ root: data.root, edgeStart, edgeLabels: labels, edgeTarget, final })
  }
}

export const DAWG_FORMAT = 'pazeh-fuzzy-dawg'
export const DAWG_VERSION = 1

/**
 * @typedef {object} SerializedDawg
 * @property {string} format
 * @property {number} version
 * @property {number} root
 * @property {number} nodeCount
 * @property {string} labels 所有邊的字元依序串成一個字串
 * @property {number[]} degrees 每個節點的出邊數
 * @property {number[]} targetDeltas 每條邊的「本節點編號 − 目標節點編號」
 * @property {number[]} finals 詞尾節點編號，差分編碼
 */

/**
 * 詞尾節點的 bitmap → 差分編碼的節點編號清單。
 * @param {Uint8Array} final
 */
function finalsToDelta(final) {
  /** @type {number[]} */
  const out = []
  let previous = 0
  for (let node = 0; node < final.length; node++) {
    if (!final[node]) continue
    out.push(out.length === 0 ? node : node - previous)
    previous = node
  }
  return out
}
