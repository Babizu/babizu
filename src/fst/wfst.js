/**
 * @file 實驗性：通用的加權有限狀態轉錄器（WFST）——惰性組合與最短路徑。
 *
 * 用途是**參考實作**：以教科書式的 WFST 組合（Mohri 2009）求「音變 ∘ 構詞 ∘ 詞庫」的真正聯合最佳解 W*，
 * 用來驗證 babizu 的特化演算法（邊界條件 DP）並量測兩者的差距與效能。不接到網站介面。
 *
 * ## 表示法
 * 轉錄器是一個惰性物件（狀態在需要時才產生）：
 * - `start`：起始狀態
 * - `key(state)`：狀態的雜湊鍵（字串）
 * - `final(state)`：終止權重（不是終止狀態時為 Infinity）
 * - `arcs(state)`：所有出弧 `{ i, o, w, to }`（i、o 是輸入／輸出標籤，EPS 表示 ε）
 * - `arcsWithInput(state, label)`：輸入標籤為 label 的出弧（組合時的「matcher」，可省略）
 * - `epsInputArcs(state)`：輸入標籤為 ε 的出弧（可省略）
 *
 * 權重在 tropical semiring（min, +）上：路徑權重相加，多條路徑取最小。所有權重必須 ≥ 0（Dijkstra 的前提）。
 */

/** ε（空標籤） */
export const EPS = ''

/**
 * @typedef {{i: string, o: string, w: number, to: any}} Arc
 * @typedef {object} Wfst
 * @property {any} start
 * @property {(state: any) => string} key
 * @property {(state: any) => number} final
 * @property {(state: any) => Arc[]} arcs
 * @property {(state: any, label: string) => Arc[]} [arcsWithInput]
 * @property {(state: any) => Arc[]} [epsInputArcs]
 */

/** @param {Wfst} t @param {any} s @param {string} label */
const withInput = (t, s, label) => (t.arcsWithInput ? t.arcsWithInput(s, label) : t.arcs(s).filter((a) => a.i === label))
/** @param {Wfst} t @param {any} s */
const epsInput = (t, s) => (t.epsInputArcs ? t.epsInputArcs(s) : t.arcs(s).filter((a) => a.i === EPS))

/**
 * 惰性組合 A ∘ B（A 的輸出接 B 的輸入）。
 *
 * 以 ε 排序過濾器（epsilon-sequencing filter，Mohri 2009）處理兩側的 ε：
 * - 「A 單獨前進」：A 走一條輸出為 ε 的弧（x:ε），B 停在原地
 * - 「B 單獨前進」：B 走一條輸入為 ε 的弧（ε:z），A 停在原地
 * 兩者交錯的不同順序會產生重複路徑。過濾器規定：在兩次「同時前進」之間，B 的單獨前進必須全部排在 A 的前面——
 * 狀態 1 表示「剛讓 A 單獨前進過」，此時不再允許 B 單獨前進；同時前進後回到狀態 0。
 * 每一組 ε 動作因此恰好保留一種排列，不遺漏任何路徑（對最短距離而言重複路徑只影響效率，不影響正確性）。
 *
 * @param {Wfst} A
 * @param {Wfst} B
 * @returns {Wfst}
 */
export function compose(A, B) {
  /** @param {any} a @param {any} b @param {number} f */
  const state = (a, b, f) => ({ a, b, f })
  /**
   * 以 A 的一條弧為起點的組合弧。
   * @param {Arc} arc
   * @param {{a: any, b: any, f: number}} s
   * @param {Arc[]} out
   */
  const fromA = (arc, s, out) => {
    if (arc.o === EPS) {
      // A 單獨前進（x:ε），B 停在原地
      out.push({ i: arc.i, o: EPS, w: arc.w, to: state(arc.to, s.b, 1) })
      return
    }
    for (const b of withInput(B, s.b, arc.o)) out.push({ i: arc.i, o: b.o, w: arc.w + b.w, to: state(arc.to, b.to, 0) })
  }
  /** B 單獨前進（ε:z），A 停在原地 @param {{a: any, b: any, f: number}} s @param {Arc[]} out */
  const bAlone = (s, out) => {
    if (s.f === 1) return
    for (const b of epsInput(B, s.b)) out.push({ i: EPS, o: b.o, w: b.w, to: state(s.a, b.to, 0) })
  }
  return {
    start: state(A.start, B.start, 0),
    key: (s) => `${A.key(s.a)}‖${B.key(s.b)}‖${s.f}`,
    final: (s) => A.final(s.a) + B.final(s.b),
    arcs(s) {
      /** @type {Arc[]} */
      const out = []
      for (const arc of A.arcs(s.a)) fromA(arc, s, out)
      bAlone(s, out)
      return out
    },
    arcsWithInput(s, label) {
      /** @type {Arc[]} */
      const out = []
      for (const arc of withInput(A, s.a, label)) fromA(arc, s, out)
      return out
    },
    epsInputArcs(s) {
      /** @type {Arc[]} */
      const out = []
      for (const arc of epsInput(A, s.a)) fromA(arc, s, out)
      bAlone(s, out)
      return out
    },
  }
}

/**
 * 字串接受器：只接受 chars 本身（輸入＝輸出），權重 0。
 * @param {string[]} chars
 * @returns {Wfst}
 */
export function stringAcceptor(chars) {
  const n = chars.length
  return {
    start: 0,
    key: (i) => String(i),
    final: (i) => (i === n ? 0 : Infinity),
    arcs: (i) => (i < n ? [{ i: chars[i], o: chars[i], w: 0, to: i + 1 }] : []),
    arcsWithInput: (i, label) => (i < n && chars[i] === label ? [{ i: label, o: label, w: 0, to: i + 1 }] : []),
    epsInputArcs: () => [],
  }
}

/**
 * 反轉：交換輸入與輸出標籤。
 * @param {Wfst} t
 * @returns {Wfst}
 */
export function invert(t) {
  const flip = (/** @type {Arc} */ a) => ({ i: a.o, o: a.i, w: a.w, to: a.to })
  return {
    start: t.start,
    key: t.key,
    final: t.final,
    arcs: (s) => t.arcs(s).map(flip),
  }
}

/**
 * 最短距離（Dijkstra）：從起始狀態出發，列出所有「成本 ≤ bound」可到達的終止狀態。
 * 同一個終止狀態（依 key）只回報一次，取最小成本。
 *
 * @param {Wfst} t
 * @param {{bound?: number, onFinal?: (state: any, cost: number) => void, maxStates?: number}} [options]
 * @returns {{best: number, expanded: number}} best：最小的終止成本（沒有則 Infinity）；expanded：展開的狀態數
 */
export function shortestDistance(t, { bound = Infinity, onFinal, maxStates = 5e6 } = {}) {
  const heap = new MinHeap()
  /** @type {Map<string, number>} */
  const settled = new Map()
  /** @type {Map<string, number>} */
  const tentative = new Map()
  heap.push(0, t.start)
  tentative.set(t.key(t.start), 0)
  let best = Infinity
  let expanded = 0
  while (heap.size > 0) {
    const [cost, s] = /** @type {[number, any]} */ (heap.pop())
    if (cost > bound + 1e-9) break
    const k = t.key(s)
    if (settled.has(k)) continue
    settled.set(k, cost)
    expanded++
    if (expanded > maxStates) throw new RangeError(`狀態數超過 ${maxStates}，請降低 bound`)
    const f = t.final(s)
    if (f < Infinity && cost + f <= bound + 1e-9) {
      best = Math.min(best, cost + f)
      onFinal?.(s, cost + f)
    }
    for (const arc of t.arcs(s)) {
      if (arc.w < 0) throw new RangeError('WFST 的權重必須非負')
      const c = cost + arc.w
      if (c > bound + 1e-9) continue
      const k2 = t.key(arc.to)
      if (settled.has(k2)) continue
      const prev = tentative.get(k2)
      if (prev !== undefined && prev <= c) continue
      tentative.set(k2, c)
      heap.push(c, arc.to)
    }
  }
  return { best: Math.round(best * 1e9) / 1e9, expanded }
}

/** 二元最小堆（成本, 值） */
class MinHeap {
  constructor() {
    /** @type {number[]} */
    this.keys = []
    /** @type {any[]} */
    this.values = []
  }
  get size() {
    return this.keys.length
  }
  /** @param {number} key @param {any} value */
  push(key, value) {
    const { keys, values } = this
    let i = keys.length
    keys.push(key)
    values.push(value)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]
      values[i] = values[p]
      i = p
    }
    keys[i] = key
    values[i] = value
  }
  pop() {
    const { keys, values } = this
    if (keys.length === 0) return undefined
    const top = [keys[0], values[0]]
    const lastKey = /** @type {number} */ (keys.pop())
    const lastValue = values.pop()
    if (keys.length > 0) {
      let i = 0
      const n = keys.length
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && keys[r] < keys[l] ? r : l
        if (keys[c] >= lastKey) break
        keys[i] = keys[c]
        values[i] = values[c]
        i = c
      }
      keys[i] = lastKey
      values[i] = lastValue
    }
    return top
  }
}
