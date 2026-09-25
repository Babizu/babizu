/**
 * @file 廣義加權編輯距離的動態規劃核心。
 *
 * 本檔是整個函式庫「唯一」實作狀態轉移的地方：兩字串的距離計算（distance.js）、
 * 解釋模式（explain）、詞圖模糊搜尋（fuzzy-index.js）都呼叫同一個 `fillRow`，
 * 以保證三者的結果永遠一致。
 *
 * ## 記號
 * - X：查詢字串（長度 N），Y：候選字串（長度 M），皆為 code point 陣列
 * - D(i, j)：把 X 的前 i 個字元轉成 Y 的前 j 個字元的最小成本
 * - 「第 j 列」：固定 j、i = 0..N 的一整列。詞圖往下走一層就是多算一列。
 *
 * ## 轉移
 * D(i, j) = min {
 *   D(i-1, j)   + del(X[i-1])                 刪除
 *   D(i, j-1)   + ins(Y[j-1])                 插入
 *   D(i-1, j-1) + sub(X[i-1], Y[j-1])         替換（相同字元為 0）
 *   D(i-|s|, j-|t|) + w   對每條匹配的規則 s→t 規則
 * }
 *
 * ## 位置限制與「詞尾列」
 * - initial：s 位於 X 的詞首，且 t 位於 Y 的詞首（前一字元不存在或是邊界字元）
 * - final：s 位於 X 的詞尾，且 t 位於 Y 的詞尾（後一字元不存在或是邊界字元）
 *
 * X 側的條件在 `compileQuery` 時就能確定。Y 側的 initial 條件只需往回看，也能確定。
 * 但 Y 側的 final 條件要看「下一個字元」——在詞圖裡同一個節點可能有好幾條出邊，
 * 下一個字元並不唯一。因此 `fillRow` 以 `allowFinal` 參數區分兩種假設：
 * - allowFinal = false：假設 Y[j] 存在且不是邊界（列 N_j）
 * - allowFinal = true ：假設 Y[j] 不存在或是邊界（列 F_j），此時才允許 final 規則
 * 往後的列引用第 j 列時，依實際的 Y[j] 選用正確的那一列。
 *
 * ## 邊界條件（構詞搜尋用）
 * 預設起點只有 D(0, 0) = 0。`compileQuery` 可以另外給起點成本向量 start：
 *   D(i, 0) = min( start[i], D(i-1, 0) + del(X[i-1]) )
 * 讓候選字串可以從 X 的任何位置 i 開始比對（前面的部分由呼叫端以 start[i] 計價，例如前綴鏈）。
 * 結尾的對應（後綴鏈）由呼叫端在詞尾取 min_i D(i, M) + end[i]。
 * 所有成本仍然非負，剪枝的下界論證不受影響（見 docs/bcdp.md 第 4、6 節）。
 *
 * ## 實作：讓每一格只剩陣列存取與加法
 *
 * 遞推式與最佳化前（commit e1557f4）完全相同，每一格的候選值也以相同的算式（同一對浮點數相加）得到；
 * 取 min 與比較的順序無關，所以每一格的結果逐位元不變。改變的只有「怎麼找到候選值」：
 *
 * 1. **字元編號**（`CompiledRules.idOf`）：每個出現過的字元給一個小整數。規則目標裡的字元
 *    最先編號（0 … trieWidth − 1），其他字元（詞庫、查詢）用到時才依序編號。
 *
 * 2. **查詢端的成本表**（`compileQuery`）：X 固定之後，
 *    - `del[i]` = del(X[i-1])：整個查詢只算一次
 *    - `subRow(plan, y)[i]` = sub(X[i-1], y)：每個候選字元 y 第一次出現時算一整列，之後重複使用
 *    - `insOf(plan, y)` = ins(y)
 *    舊版每一格都要以字串查兩到三次覆寫表（`Map<string>`），現在是一次陣列讀取。
 *
 * 3. **規則目標 trie 與路徑匹配器**（`PathMatcher`）：
 *    第 j 列需要知道「哪些規則的 target 恰好是 Y 在位置 j 結尾的後綴」。舊版在每個節點把
 *    Y 的後綴逐一串成字串，再拿去查雜湊表。新版把所有 target 建成一棵 trie，沿著詞圖路徑
 *    逐層維護「目前可能還在某個 target 中間的 trie 狀態」：
 *      states(j) = { child(s, Y[j-1]) : s ∈ states(j-1) ∪ {root} }
 *    這和 Aho–Corasick 自動機的「所有部分匹配」集合相同，但因為規則少、target 短（≤ 5），
 *    直接保留整個集合（每層最多 maxTargetLength 個）比建失敗連結簡單。
 *    - 狀態 s 若是某個 target 的結尾 ⇒ 該 target 以長度 depth(s) 結尾於位置 j，規則轉移的來源列是 j − depth(s)
 *    - 狀態 s 若還能延伸成更長的 target ⇒ 第 r = j − depth(s) 列可以「跳過」第 j 列，
 *      剪枝下界要把 min(第 r 列) + jump(s) 算進去（jump(s) 是經過 s 的更長 target 的最小權重）
 *    同一組狀態同時供應「規則匹配」與「跨列剪枝」，而且與通道無關，每個詞圖節點只算一次。
 *
 * 4. **查詢端的規則表**：`compileQuery` 把「source 恰好結束在 X 的位置 i、X 側位置條件成立」
 *    的規則，依 target 編號分組存成平坦陣列（位置、source 長度、權重、旗標）。
 *    第 j 列時，對每個匹配到的 target，把它的規則轉移一次算進暫存列 `ruleMin`，
 *    主迴圈只要多比較一次 ruleMin[i]。target 為空字串（脫落規則）的來源是同一列，
 *    必須在主迴圈中依 i 的順序處理。
 *
 * 5. **列的最小值**：`fillRow` 在計算時順便求出並回傳，剪枝不必再掃一次。
 *
 * 追蹤模式（explain／演算法實驗室）走另一條較慢的分支，逐一回報每個候選轉移，
 * 回報順序與舊版相同（插入、替換、刪除、規則依 target 長度遞增），所以 explain 的結果不變。
 */

/** 浮點誤差容忍值：0.1 累加三次會得到 0.30000000000000004 */
export const EPSILON = 1e-9

/**
 * 把成本四捨五入到 1e-9，消除浮點累加誤差，方便比較與顯示。
 * @param {number} x
 */
export function roundCost(x) {
  return Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x
}

/** 規則旗標：final 規則（Y 側需要 allowFinal） */
const FLAG_FINAL = 1
/** 規則旗標：initial 規則（Y 側的 target 必須在詞首） */
const FLAG_INITIAL = 2

/**
 * @typedef {import('./rules.js').Rule & {sourceLength: number, targetLength: number, targetId: number}} CompiledRule
 */

/**
 * @typedef {object} QueryPlan 針對單一查詢字串預先算好的成本表與規則表
 * @property {string[]} chars 查詢字串 X
 * @property {Int32Array} ids X 的字元編號
 * @property {number} n X 的長度
 * @property {import('./costs.js').CostModel} costs
 * @property {Float64Array} del del[i] = del(X[i-1])（i ≥ 1）
 * @property {Array<Float64Array | undefined>} subRows subRows[y] = 對候選字元 y 的替換成本列（用到時才算）
 * @property {Array<number | undefined>} insCosts insCosts[y] = ins(y)（用到時才算）
 * @property {Int32Array} ruleOff 規則表：target 編號 T 的規則在 [ruleOff[T], ruleOff[T+1]) 之間，依 i 遞增
 * @property {Int32Array} ruleI 規則的 source 結束在 X 的位置 i
 * @property {Int32Array} ruleSrc source 長度
 * @property {Float64Array} ruleW 權重
 * @property {Uint8Array} ruleFlag FLAG_FINAL／FLAG_INITIAL
 * @property {CompiledRule[]} ruleRef 規則本身（追蹤模式回報用）
 * @property {boolean} hasFinal 是否有任何 final 規則匹配到 X（沒有的話 F_j 恆等於 N_j）
 * @property {Float64Array | null} start 第 0 列的起點成本（null 表示只有 D(0, 0) = 0）
 * @property {Float64Array} ruleMin 暫存：本列所有「來源在較早的列」的規則轉移的最小值
 * @property {ColumnContext} column 計算列時重複使用的暫存
 */

/**
 * @typedef {object} QueryOptions
 * @property {ArrayLike<number> | null} [start] 起點成本向量（長度 N + 1）；見檔頭「邊界條件」
 * @property {ArrayLike<boolean> | null} [extraInitial] 額外視為「X 的詞首」的位置（例如前綴鏈的終點）
 * @property {ArrayLike<boolean> | null} [extraFinal] 額外視為「X 的詞尾」的位置（例如後綴鏈的起點）
 */

/**
 * 規則的索引、字元編號與 target trie。建立一次後可重複用於任意查詢。
 */
export class CompiledRules {
  /**
   * @param {import('./rules.js').Rule[]} rules 已正規化、已展開反向的規則
   * @param {Set<string>} boundaries 詞邊界字元（預設為空白）
   */
  constructor(rules, boundaries) {
    this.boundaries = boundaries

    // ── 字元編號 ──
    /** @type {Map<string, number>} 字元 → 編號 */
    this._ids = new Map()
    /** @type {string[]} 編號 → 字元 */
    this.chars = []
    /** @type {number[]} 編號 → 是否為邊界字元（0／1） */
    this._boundaryById = []

    // ── target：去重、編號，target 的字元最先編號 ──
    /** @type {string[]} target 編號 → target 字串 */
    this.targets = []
    /** @type {Map<string, number>} */
    const targetIds = new Map()
    for (const r of rules) {
      if (!targetIds.has(r.target)) {
        targetIds.set(r.target, this.targets.length)
        this.targets.push(r.target)
      }
    }
    for (const t of this.targets) for (const ch of t) this.idOf(ch)
    /** trie 的字元寬度：編號 ≥ trieWidth 的字元不在任何 target 中，一定沒有子節點 */
    this.trieWidth = Math.max(1, this.chars.length)

    /** @type {CompiledRule[]} */
    this.rules = rules.map((r) => ({
      ...r,
      sourceLength: Array.from(r.source).length,
      targetLength: Array.from(r.target).length,
      targetId: /** @type {number} */ (targetIds.get(r.target)),
    }))
    /** @type {Map<string, CompiledRule[]>} 以 source 字串為鍵 */
    this.bySource = new Map()
    for (const rule of this.rules) {
      const list = this.bySource.get(rule.source)
      if (list) list.push(rule)
      else this.bySource.set(rule.source, [rule])
    }
    /** 出現過的 source 長度（遞增） */
    this.sourceLengths = uniqueSorted(this.rules.map((r) => r.sourceLength))
    /** 出現過的 target 長度（遞增） */
    this.targetLengths = uniqueSorted(this.rules.map((r) => r.targetLength))
    /** 最長的 target 長度；一次轉移最多跨越的列數，決定剪枝要看幾列 */
    this.maxTargetLength = Math.max(1, ...this.targetLengths)

    // ── target trie ──
    // 節點 0 是根（空字串）。trieChild[s * trieWidth + c] = 子節點（-1 表示沒有）。
    /** @type {number[]} */
    const child = []
    /** @type {number[]} */
    const depth = [0]
    /** @type {number[]} 節點是哪個 target 的結尾（-1 表示不是） */
    const targetAt = [-1]
    /** @type {number[]} 經過此節點、且比它更長的 target 的最小規則權重（跨列剪枝用） */
    const jump = [Infinity]
    const width = this.trieWidth
    for (let k = 0; k < width; k++) child.push(-1)
    this.targets.forEach((t, T) => {
      let s = 0
      for (const ch of t) {
        const c = this.idOf(ch)
        let next = child[s * width + c]
        if (next === -1) {
          next = depth.length
          depth.push(depth[s] + 1)
          targetAt.push(-1)
          jump.push(Infinity)
          for (let k = 0; k < width; k++) child.push(-1)
          child[s * width + c] = next
        }
        s = next
      }
      targetAt[s] = T
    })
    // jump：對每條規則，target 的每個「真前綴」節點（深度 1 … |t|-1）取最小權重。
    // 與舊版的 jumpWeights（以前綴字串為鍵）是同一張表，只是改以 trie 節點為鍵。
    for (const rule of this.rules) {
      let s = 0
      let p = 0
      for (const ch of rule.target) {
        if (p >= 1) jump[s] = Math.min(jump[s], rule.weight)
        s = child[s * width + this.idOf(ch)]
        p++
      }
    }
    this.trieChild = Int32Array.from(child)
    this.trieDepth = Int32Array.from(depth)
    this.trieTarget = Int32Array.from(targetAt)
    this.trieJump = Float64Array.from(jump)
    /** target 長度（依 target 編號） */
    this.targetLength = Int32Array.from(this.targets, (t) => Array.from(t).length)
    /** 空字串 target（脫落規則）的編號；沒有則為 -1 */
    this.emptyTarget = targetIds.get('') ?? -1
  }

  /**
   * 字元的編號；第一次見到的字元依序給新編號。
   * @param {string} ch 單一 code point
   */
  idOf(ch) {
    let id = this._ids.get(ch)
    if (id === undefined) {
      id = this.chars.length
      this._ids.set(ch, id)
      this.chars.push(ch)
      this._boundaryById.push(this.boundaries.has(ch) ? 1 : 0)
    }
    return id
  }

  /** @param {number} id */
  isBoundaryId(id) {
    return this._boundaryById[id] === 1
  }

  /** @param {string | undefined} ch */
  isBoundary(ch) {
    return ch !== undefined && this.boundaries.has(ch)
  }

  /**
   * 為查詢字串建立成本表與規則表。
   * @param {string[]} x 查詢字串（code point 陣列）
   * @param {import('./costs.js').CostModel} costs
   * @param {QueryOptions} [options]
   * @returns {QueryPlan}
   */
  compileQuery(x, costs, options = {}) {
    const n = x.length
    const { start = null, extraInitial = null, extraFinal = null } = options
    const ids = Int32Array.from(x, (ch) => this.idOf(ch))
    const del = new Float64Array(n + 1)
    for (let i = 1; i <= n; i++) del[i] = costs.del(x[i - 1])

    // 先依出現順序收集，再依 target 做穩定的計數排序。桶內的順序＝舊版 at[i] 中同一 target 的規則順序
    // （i 遞增；同一個 i 依 source 長度遞增、再依規則原本的順序），追蹤模式因此與舊版一致。
    /** @type {number[]} */
    const foundI = []
    /** @type {CompiledRule[]} */
    const foundRule = []
    let hasFinal = false
    const lengths = this.sourceLengths
    for (let i = 0; i <= n; i++) {
      // key ＝ x[i−a..i)，a 由 0 遞增時往左逐字加長（不必每次切片）
      let key = ''
      let a = 0
      for (let li = 0; li < lengths.length; li++) {
        const want = lengths[li]
        if (want > i) break
        while (a < want) key = x[i - ++a] + key
        const candidates = this.bySource.get(key)
        if (!candidates) continue
        for (const rule of candidates) {
          if (rule.position === 'initial' && !(i - a === 0 || this.isBoundary(x[i - a - 1]) || extraInitial?.[i - a])) {
            continue
          }
          if (rule.position === 'final' && !(i === n || this.isBoundary(x[i]) || extraFinal?.[i])) continue
          if (rule.position === 'final') hasFinal = true
          foundI.push(i)
          foundRule.push(rule)
        }
      }
    }
    const total = foundRule.length
    const ruleOff = new Int32Array(this.targets.length + 1)
    for (const rule of foundRule) ruleOff[rule.targetId + 1]++
    for (let T = 0; T < this.targets.length; T++) ruleOff[T + 1] += ruleOff[T]
    const cursor = ruleOff.slice(0, this.targets.length)
    const ruleI = new Int32Array(total)
    const ruleSrc = new Int32Array(total)
    const ruleW = new Float64Array(total)
    const ruleFlag = new Uint8Array(total)
    /** @type {CompiledRule[]} */
    const ruleRef = new Array(total)
    for (let e = 0; e < total; e++) {
      const rule = foundRule[e]
      const k = cursor[rule.targetId]++
      ruleI[k] = foundI[e]
      ruleSrc[k] = rule.sourceLength
      ruleW[k] = rule.weight
      ruleFlag[k] = (rule.position === 'final' ? FLAG_FINAL : 0) | (rule.position === 'initial' ? FLAG_INITIAL : 0)
      ruleRef[k] = rule
    }

    const cap = this.maxTargetLength + 1
    return {
      chars: x,
      ids,
      n,
      costs,
      del,
      subRows: [],
      insCosts: [],
      ruleOff,
      ruleI,
      ruleSrc,
      ruleW,
      ruleFlag,
      ruleRef,
      hasFinal,
      start: start ? Float64Array.from(start) : null,
      ruleMin: new Float64Array(n + 1),
      column: {
        j: 0,
        y: -1,
        prevRow: null,
        count: 0,
        targets: new Int32Array(cap),
        lengths: new Int32Array(cap),
        rows: new Array(cap).fill(null),
        initial: new Uint8Array(cap),
        emptyInitial: false,
      },
    }
  }
}

/**
 * 查詢 X 對候選字元 y 的替換成本列：row[i] = sub(X[i-1], y)。第一次用到 y 時才算。
 * @param {QueryPlan} plan
 * @param {CompiledRules} compiled
 * @param {number} y 字元編號
 */
function subRowOf(plan, compiled, y) {
  let row = plan.subRows[y]
  if (row === undefined) {
    row = new Float64Array(plan.n + 1)
    const ch = compiled.chars[y]
    for (let i = 1; i <= plan.n; i++) row[i] = plan.costs.sub(plan.chars[i - 1], ch)
    plan.subRows[y] = row
  }
  return row
}

/**
 * ins(y)，第一次用到 y 時才查成本表。
 * @param {QueryPlan} plan
 * @param {CompiledRules} compiled
 * @param {number} y
 */
function insOf(plan, compiled, y) {
  let c = plan.insCosts[y]
  if (c === undefined) plan.insCosts[y] = c = plan.costs.ins(compiled.chars[y])
  return c
}

/**
 * 路徑匹配器：沿著候選字串 Y（詞圖的路徑）逐層維護 target trie 的狀態集合。
 *
 * 第 j 層（已確定 Y 的前 j 個字元）的狀態集合是所有「Y[r..j) 是某個 target 的前綴」的 trie 節點，
 * 依深度遞增排列（深度 d 對應 r = j − d）。由第 j−1 層推得：先放根走 Y[j-1] 的子節點（深度 1），
 * 再依序放上一層每個狀態走 Y[j-1] 的子節點（深度 +1），所以排列自然保持遞增。
 *
 * 詞圖走訪時，同一深度的兄弟節點會覆寫同一層的資料；前一個兄弟的子樹走完才會覆寫，
 * 與 DP 的列相同，所以每層只需一份。
 */
export class PathMatcher {
  /** @param {CompiledRules} compiled */
  constructor(compiled) {
    this.compiled = compiled
    /** 每層最多幾個狀態：深度 1 … maxTargetLength */
    this.cap = compiled.maxTargetLength
    this._grow(32)
  }

  /** @param {number} size 可容納的最大深度 */
  _grow(size) {
    const ids = new Int32Array(size)
    const boundary = new Uint8Array(size)
    const states = new Int32Array((size + 1) * this.cap)
    const counts = new Int32Array(size + 1)
    if (this.ids) {
      ids.set(this.ids)
      boundary.set(this.boundary)
      states.set(this.states)
      counts.set(this.counts)
    }
    /** ids[r] = Y[r] 的字元編號 */
    this.ids = ids
    /** boundary[r] = Y[r] 是否為邊界字元；決定引用第 r 列時用 F_r 還是 N_r */
    this.boundary = boundary
    /** 第 j 層的狀態：states[j * cap + k]，k < counts[j] */
    this.states = states
    this.counts = counts
  }

  /**
   * 設定 Y[j-1] = 字元 y，並算出第 j 層的狀態集合（j ≥ 1；第 0 層恆為空）。
   * @param {number} j
   * @param {number} y 字元編號
   */
  set(j, y) {
    if (j >= this.ids.length) this._grow(this.ids.length * 2)
    const { compiled, cap, states, counts } = this
    this.ids[j - 1] = y
    this.boundary[j - 1] = compiled.isBoundaryId(y) ? 1 : 0
    let count = 0
    if (y < compiled.trieWidth) {
      const width = compiled.trieWidth
      const child = compiled.trieChild
      const out = j * cap
      const first = child[y]
      if (first !== -1) states[out + count++] = first
      const prev = (j - 1) * cap
      for (let k = 0; k < counts[j - 1]; k++) {
        const next = child[states[prev + k] * width + y]
        if (next !== -1 && count < cap) states[out + count++] = next
      }
    }
    counts[j] = count
  }
}

/**
 * @typedef {object} ColumnContext
 * 計算第 j 列所需、與 allowFinal 無關的準備資料。N_j 與 F_j 共用同一份，只準備一次。
 * 物件本身存放在 QueryPlan 上重複使用（fillRow 不會遞迴，所以不會互相覆寫）。
 * @property {number} j
 * @property {number} y Y[j-1] 的字元編號（j = 0 時為 -1）
 * @property {Float64Array | null} prevRow 第 j-1 列的實際數值
 * @property {number} count 本列匹配到、且在 X 中有規則的非空 target 個數
 * @property {Int32Array} targets targets[k]：target 編號（依長度遞增）
 * @property {Int32Array} lengths lengths[k]：target 長度 t
 * @property {Array<Float64Array | null>} rows rows[k]：規則轉移的來源列（第 j − t 列）
 * @property {Uint8Array} initial initial[k]：該 target 是否位於 Y 的詞首
 * @property {boolean} emptyInitial 空字串 target 是否位於 Y 的詞首（j = 0 或 Y[j-1] 是邊界）
 */

/**
 * 準備第 j 列的共用資料。
 * @param {QueryPlan} plan
 * @param {CompiledRules} compiled
 * @param {PathMatcher} path 已設定到第 j 層的路徑匹配器
 * @param {number} j
 * @param {(row: number) => Float64Array} rowAt 取得先前第 row 列（row < j）的「實際」數值
 * @returns {ColumnContext}
 */
export function prepareColumn(plan, compiled, path, j, rowAt) {
  const ctx = plan.column
  ctx.j = j
  ctx.y = j > 0 ? path.ids[j - 1] : -1
  ctx.prevRow = j > 0 ? rowAt(j - 1) : null
  ctx.emptyInitial = j === 0 || path.boundary[j - 1] === 1

  let count = 0
  const base = j * path.cap
  const ruleOff = plan.ruleOff
  for (let k = 0; k < path.counts[j]; k++) {
    const s = path.states[base + k]
    const T = compiled.trieTarget[s]
    // 只留下「是某個 target 的結尾」且「這個 target 在 X 中有匹配的規則」的狀態
    if (T === -1 || ruleOff[T + 1] === ruleOff[T]) continue
    const t = compiled.trieDepth[s]
    ctx.targets[count] = T
    ctx.lengths[count] = t
    ctx.rows[count] = rowAt(j - t)
    ctx.initial[count] = j - t === 0 || path.boundary[j - t - 1] === 1 ? 1 : 0
    count++
  }
  ctx.count = count
  return ctx
}

/**
 * 第 j 列的剪枝下界中「跨列」的部分：min over 狀態 s ∈ 第 j 層 of min(第 j − depth(s) 列) + jump(s)。
 * 第 r 列要跨過第 j 列，唯一的方式是一條 target 以 Y[r..j) 開頭、且比它更長的規則。
 * @param {CompiledRules} compiled
 * @param {PathMatcher} path
 * @param {number} j
 * @param {(r: number) => number} minAt 第 r 列（依 Y[r] 選 N／F）的最小值
 */
export function jumpBound(compiled, path, j, minAt) {
  let bound = Infinity
  const base = j * path.cap
  for (let k = 0; k < path.counts[j]; k++) {
    const s = path.states[base + k]
    const jump = compiled.trieJump[s]
    if (jump === Infinity) continue
    const v = minAt(j - compiled.trieDepth[s]) + jump
    if (v < bound) bound = v
  }
  return bound
}

/**
 * @typedef {'match' | 'substitute' | 'delete' | 'insert' | 'rule'} Operation
 */

/**
 * @typedef {object} Transition fillRow 在追蹤模式下回報的每一個候選轉移
 * @property {number} i
 * @property {number} j
 * @property {number} fromI
 * @property {number} fromJ
 * @property {number} cost 到達 (i, j) 的總成本
 * @property {number} stepCost 這一步本身的成本
 * @property {Operation} op
 * @property {CompiledRule | null} rule
 */

/**
 * 計算第 j 列，回傳這一列的最小值（剪枝用）。
 *
 * @param {QueryPlan} plan 查詢的成本表與規則表
 * @param {CompiledRules} compiled
 * @param {ColumnContext} ctx prepareColumn 的結果
 * @param {boolean} allowFinal 是否假設 Y 在位置 j 是詞尾（見檔頭說明）
 * @param {Float64Array} out 輸出，長度至少 N + 1
 * @param {((t: Transition) => void) | null} [trace] 追蹤模式：回報每個候選轉移（視覺化用）
 * @returns {number} min(out[0..N])
 */
export function fillRow(plan, compiled, ctx, allowFinal, out, trace = null) {
  if (trace) return fillRowTraced(plan, compiled, ctx, allowFinal, out, trace)
  const n = plan.n
  const { j, prevRow } = ctx
  const del = plan.del
  const { ruleI, ruleSrc, ruleW, ruleFlag } = plan

  // ① 來源在較早的列（target 非空）的規則轉移：先整批算進暫存列 ruleMin。
  //    這些轉移只讀較早的列，與本列的計算順序無關，可以提前算好。
  let hasRules = false
  const ruleMin = plan.ruleMin
  if (ctx.count > 0) {
    ruleMin.fill(Infinity)
    for (let k = 0; k < ctx.count; k++) {
      const T = ctx.targets[k]
      const predRow = /** @type {Float64Array} */ (ctx.rows[k])
      const yInitial = ctx.initial[k] === 1
      for (let p = plan.ruleOff[T]; p < plan.ruleOff[T + 1]; p++) {
        const flag = ruleFlag[p]
        if (flag & FLAG_FINAL && !allowFinal) continue
        if (flag & FLAG_INITIAL && !yInitial) continue
        const i = ruleI[p]
        const c = predRow[i - ruleSrc[p]] + ruleW[p]
        if (c < ruleMin[i]) ruleMin[i] = c
      }
    }
    hasRules = true
  }

  // ② 空字串 target（脫落規則）的來源是同一列較小的 i，要在主迴圈中依 i 順序處理
  const E = compiled.emptyTarget
  let p = E === -1 ? 0 : plan.ruleOff[E]
  const pEnd = E === -1 ? 0 : plan.ruleOff[E + 1]

  // ③ 主迴圈
  const start = plan.start
  const subRow = prevRow ? subRowOf(plan, compiled, ctx.y) : null
  const insertCost = prevRow ? insOf(plan, compiled, ctx.y) : 0
  let min = Infinity
  for (let i = 0; i <= n; i++) {
    // 起點：預設 D(0, 0) = 0；有邊界條件時第 0 列的每一格都可以是起點
    let best = j === 0 ? (start ? start[i] : i === 0 ? 0 : Infinity) : Infinity
    if (prevRow) {
      const c1 = prevRow[i] + insertCost // 插入 Y[j-1]
      if (c1 < best) best = c1
      if (i > 0) {
        const c2 = prevRow[i - 1] + /** @type {Float64Array} */ (subRow)[i] // 替換／相同
        if (c2 < best) best = c2
      }
    }
    if (i > 0) {
      const c3 = out[i - 1] + del[i] // 刪除 X[i-1]
      if (c3 < best) best = c3
    }
    if (hasRules && ruleMin[i] < best) best = ruleMin[i]
    for (; p < pEnd && ruleI[p] <= i; p++) {
      if (ruleI[p] < i) continue
      const flag = ruleFlag[p]
      if (flag & FLAG_FINAL && !allowFinal) continue
      if (flag & FLAG_INITIAL && !ctx.emptyInitial) continue
      const c4 = out[i - ruleSrc[p]] + ruleW[p]
      if (c4 < best) best = c4
    }
    out[i] = best
    if (best < min) min = best
  }
  return min
}

/**
 * fillRow 的追蹤版本：逐格回報每一個候選轉移。
 * 回報順序與最佳化前相同：插入、替換、刪除，再依 target 長度遞增回報規則
 * （同一 target 內依規則在 compileQuery 中的順序），所以 explain 在同分時選到的轉移不變。
 * @param {QueryPlan} plan
 * @param {CompiledRules} compiled
 * @param {ColumnContext} ctx
 * @param {boolean} allowFinal
 * @param {Float64Array} out
 * @param {(t: Transition) => void} trace
 */
function fillRowTraced(plan, compiled, ctx, allowFinal, out, trace) {
  const n = plan.n
  const { j, prevRow } = ctx
  const { ruleOff, ruleI, ruleSrc, ruleW, ruleFlag, ruleRef } = plan
  const subRow = prevRow ? subRowOf(plan, compiled, ctx.y) : null
  const insertCost = prevRow ? insOf(plan, compiled, ctx.y) : 0
  /** 依 target 長度遞增：空字串 target（長度 0）在最前面 */
  const order = []
  if (compiled.emptyTarget !== -1) order.push({ T: compiled.emptyTarget, t: 0, row: null, initial: ctx.emptyInitial })
  for (let k = 0; k < ctx.count; k++) {
    order.push({ T: ctx.targets[k], t: ctx.lengths[k], row: ctx.rows[k], initial: ctx.initial[k] === 1 })
  }
  let min = Infinity
  for (let i = 0; i <= n; i++) {
    let best = j === 0 ? (plan.start ? plan.start[i] : i === 0 ? 0 : Infinity) : Infinity
    if (prevRow) {
      const c1 = prevRow[i] + insertCost
      if (c1 < best) best = c1
      trace({ i, j, fromI: i, fromJ: j - 1, cost: c1, stepCost: insertCost, op: 'insert', rule: null })
      if (i > 0) {
        const subCost = /** @type {Float64Array} */ (subRow)[i]
        const c2 = prevRow[i - 1] + subCost
        if (c2 < best) best = c2
        const op = plan.ids[i - 1] === ctx.y ? 'match' : 'substitute'
        trace({ i, j, fromI: i - 1, fromJ: j - 1, cost: c2, stepCost: subCost, op, rule: null })
      }
    }
    if (i > 0) {
      const deleteCost = plan.del[i]
      const c3 = out[i - 1] + deleteCost
      if (c3 < best) best = c3
      trace({ i, j, fromI: i - 1, fromJ: j, cost: c3, stepCost: deleteCost, op: 'delete', rule: null })
    }
    for (const { T, t, row, initial } of order) {
      const predRow = row ?? out
      for (let p = ruleOff[T]; p < ruleOff[T + 1]; p++) {
        if (ruleI[p] !== i) continue
        const flag = ruleFlag[p]
        if (flag & FLAG_FINAL && !allowFinal) continue
        if (flag & FLAG_INITIAL && !initial) continue
        const c4 = predRow[i - ruleSrc[p]] + ruleW[p]
        if (c4 < best) best = c4
        trace({ i, j, fromI: i - ruleSrc[p], fromJ: j - t, cost: c4, stepCost: ruleW[p], op: 'rule', rule: ruleRef[p] })
      }
    }
    out[i] = best
    if (best < min) min = best
  }
  return min
}

/** @param {number[]} values */
function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b)
}
