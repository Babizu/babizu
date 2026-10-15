/**
 * @file 廣義加權編輯距離的動態規劃核心。
 *
 * 本檔是整個函式庫「唯一」實作狀態轉移的地方：兩字串的距離計算（distance.ts）、
 * 解釋模式（explain）、詞圖模糊搜尋（fuzzy-index.ts）都呼叫同一個 `fillRow`，
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
 * ## 詞素交界（構詞搜尋用，docs/bcdp.md 第 1、4 節）
 * 構詞搜尋把「前綴鏈 · 詞幹 · 後綴鏈」當作一條底層字串 Y，詞素交界是 Y 上的位置。
 * 一次 DP 只走其中一段（一個詞綴或詞幹），前一段留下的「交界狀態」當作這一段的起點：
 * - 起點列：`compileQuery` 的 start 就是交界列 R，D(i, 0) = min( R[i], D(i-1, 0) + del(X[i-1]) )
 * - 還沒走完、跨越交界的規則：由呼叫端以「跨界狀態」（target trie 的節點＋它起點那一列）交給
 *   prepareColumn，與本段路徑上的規則一起處理
 *
 * 交界的位置語意（Y 側在交界時，X 側不另外檢查，因為交界就是對齊經過的切點）：
 * - 位置種類：EDGE_NONE 詞中、EDGE_WORD 詞首詞尾（或邊界字元旁）、EDGE_JUNCTION 詞素交界、
 *   EDGE_CROSS 規則跨越了交界
 * - initial／final 規則：Y 側在 EDGE_WORD 時照舊也要求 X 側在詞首／詞尾；在 EDGE_JUNCTION 時不要求
 * - 構詞音變（只在交界適用的規則）：只看 EDGE_JUNCTION
 * - 跨越交界的只能是沒有位置限制的方言規則
 * - 交界列（第 0 列與詞尾的交界列）上，X 的切點不能在邊界字元（空白）旁：構詞不跨越空白
 * 沒有交界時（普通搜尋），只有一般的位置語意。
 * 所有成本仍然非負，剪枝的下界論證不受影響（見 docs/bcdp.md 第 7 節）。
 *
 * ## 實作：讓每一格只剩陣列存取與加法
 *
 * 1. **字元編號**（`CompiledRules.idOf`）：每個出現過的字元給一個小整數。規則目標裡的字元
 *    最先編號（0 … trieWidth − 1），其他字元（詞庫、查詢）用到時才依序編號。
 *
 * 2. **查詢端的成本表**（`compileQuery`）：X 固定之後，
 *    - `del[i]` = del(X[i-1])：整個查詢只算一次
 *    - `subRow(plan, y)[i]` = sub(X[i-1], y)：每個候選字元 y 第一次出現時算一整列，之後重複使用
 *    - `insOf(plan, y)` = ins(y)
 *    每一格只是一次陣列讀取，不再查字元的覆寫表。
 *
 * 3. **規則目標 trie 與路徑匹配器**（`PathMatcher`）：
 *    第 j 列需要知道「哪些規則的 target 恰好是 Y 在位置 j 結尾的後綴」。所有 target 建成一棵 trie，
 *    沿著詞圖路徑逐層維護「目前可能還在某個 target 中間的 trie 狀態」：
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
 * 每一格的候選值都以同一對浮點數相加得到，取 min 的順序不影響結果，所以這些做法不改變任何一格的值。
 * 追蹤模式（explain／演算法實驗室）走另一條較慢的分支，逐一回報每個候選轉移，
 * 回報順序固定（插入、替換、刪除，再依 target 長度遞增回報規則），所以同分時 explain 選到的轉移是固定的。
 */

import type { CostModel } from './costs.ts'
import type { Rule } from './rules.ts'

/** 浮點誤差容忍值：0.1 累加三次會得到 0.30000000000000004 */
export const EPSILON = 1e-9

/** 把成本四捨五入到 1e-9，消除浮點累加誤差，方便比較與顯示。 */
export function roundCost(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x
}

/** 規則旗標：final 規則（Y 側需要 allowFinal） */
const FLAG_FINAL = 1
/** 規則旗標：initial 規則（Y 側的 target 必須在詞首） */
const FLAG_INITIAL = 2
/** 規則旗標：X 側的位置條件（詞首／詞尾）在這個位置不成立；只有 Y 側在詞素交界時才可以用 */
const FLAG_XFAIL = 4
/** 規則旗標：構詞音變，只在詞素交界適用 */
const FLAG_JUNCTION = 8
/** 規則旗標：source 含邊界字元；交界列上不能用（構詞不跨越空白） */
const FLAG_BSRC = 16

/** 位置種類：詞中 */
export const EDGE_NONE = 0
/** 位置種類：詞首或詞尾（字串兩端、邊界字元旁） */
export const EDGE_WORD = 1
/** 位置種類：詞素交界 */
export const EDGE_JUNCTION = 2
/** 位置種類：規則的 target 跨越了詞素交界（起點在前一段） */
export const EDGE_CROSS = 3

/** 位置種類（EDGE_*） */
export type Edge = typeof EDGE_NONE | typeof EDGE_WORD | typeof EDGE_JUNCTION | typeof EDGE_CROSS

/**
 * 有位置旗標的規則在這裡是否適用。
 * @param flag 規則旗標（≠ 0）
 * @param start target 起點的位置種類
 * @param end target 終點的位置種類（即 fillRow 的 allowFinal）
 */
function admissible(flag: number, start: number, end: number): boolean {
  if (start === EDGE_CROSS) return false
  const strict = flag & (FLAG_XFAIL | FLAG_JUNCTION)
  if (flag & FLAG_INITIAL && (start === EDGE_NONE || (start === EDGE_WORD && strict))) return false
  if (flag & FLAG_FINAL && (end === EDGE_NONE || (end === EDGE_WORD && strict))) return false
  // 沒有指定側的構詞音變：target 的任一端碰到交界即可
  if (flag & FLAG_JUNCTION && !(flag & (FLAG_INITIAL | FLAG_FINAL)) && start !== EDGE_JUNCTION && end !== EDGE_JUNCTION) return false
  return true
}

/** 編譯後的規則：加上 source、target 的長度與 target 編號 */
export interface CompiledRule extends Rule {
  sourceLength: number
  targetLength: number
  targetId: number
  /** source 含邊界字元（交界列上不能用） */
  sourceBoundary: boolean
}

/** 針對單一查詢字串預先算好的成本表與規則表 */
export interface QueryPlan {
  /** 查詢字串 X */
  chars: string[]
  /** X 的字元編號 */
  ids: Int32Array
  /** X 的長度 */
  n: number
  costs: CostModel
  /** del[i] = del(X[i-1])（i ≥ 1） */
  del: Float64Array
  /** subRows[y] = 對候選字元 y 的替換成本列（用到時才算） */
  subRows: Array<Float64Array | undefined>
  /** insCosts[y] = ins(y)（用到時才算） */
  insCosts: Array<number | undefined>
  /** 規則表：target 編號 T 的規則在 [ruleOff[T], ruleOff[T+1]) 之間，依 i 遞增 */
  ruleOff: Int32Array
  /** 規則的 source 結束在 X 的位置 i */
  ruleI: Int32Array
  /** source 長度 */
  ruleSrc: Int32Array
  /** 權重 */
  ruleW: Float64Array
  /** FLAG_* */
  ruleFlag: Uint8Array
  /** 規則本身（追蹤模式回報用） */
  ruleRef: CompiledRule[]
  /** 是否有任何「在詞尾適用」的規則匹配到 X（沒有的話 F_j 恆等於 N_j） */
  hasFinal: boolean
  /** 第 0 列的起點成本（null 表示只有 D(0, 0) = 0） */
  start: Float64Array | null
  /** junctionMask[i] ＝ 1：X 的位置 i 在邊界字元旁，不能當作詞素交界的切點 */
  junctionMask: Uint8Array
  /** X 的邊界字元完全不能被消耗（詞綴的 DP 用） */
  lockBoundary: boolean
  /** 暫存：本列所有「來源在較早的列」的規則轉移的最小值 */
  ruleMin: Float64Array
  /** 計算列時重複使用的暫存 */
  column: ColumnContext
}

export interface QueryOptions {
  /** 起點成本向量（長度 N + 1），即前一段留下的交界列；見檔頭「詞素交界」 */
  start?: ArrayLike<number> | null
  /**
   * 這段 DP 會碰到詞素交界：保留 X 側位置條件不成立的規則與構詞音變（它們只在 Y 側位於交界時適用）。
   * 沒有交界的普通搜尋不需要（預設 false）
   */
  junctions?: boolean
  /** X 的邊界字元（空白）完全不能被消耗：詞綴不含空白（預設 false） */
  lockBoundary?: boolean
}

/**
 * 規則的索引、字元編號與 target trie。建立一次後可重複用於任意查詢。
 */
export class CompiledRules {
  /** 詞邊界字元（預設為空白） */
  readonly boundaries: Set<string>
  /** 字元 → 編號 */
  private readonly _ids = new Map<string, number>()
  /** 編號 → 字元 */
  readonly chars: string[] = []
  /** 編號 → 是否為邊界字元（0／1） */
  private readonly _boundaryById: number[] = []
  /** target 編號 → target 字串 */
  readonly targets: string[] = []
  /** trie 的字元寬度：編號 ≥ trieWidth 的字元不在任何 target 中，一定沒有子節點 */
  readonly trieWidth: number
  readonly rules: CompiledRule[]
  /** 以 source 字串為鍵 */
  readonly bySource = new Map<string, CompiledRule[]>()
  /** 出現過的 source 長度（遞增） */
  readonly sourceLengths: number[]
  /** 出現過的 target 長度（遞增） */
  readonly targetLengths: number[]
  /** 最長的 target 長度；一次轉移最多跨越的列數，決定剪枝要看幾列 */
  readonly maxTargetLength: number
  /** trieChild[s * trieWidth + c] = 子節點（-1 表示沒有）；節點 0 是根（空字串） */
  readonly trieChild: Int32Array
  readonly trieDepth: Int32Array
  /** 節點是哪個 target 的結尾（-1 表示不是） */
  readonly trieTarget: Int32Array
  /** 經過此節點、且比它更長的 target 的最小規則權重（跨列剪枝用） */
  readonly trieJump: Float64Array
  /** 父節點（根為 -1）：由節點還原字串用 */
  readonly trieParent: Int32Array
  /** 進入這個節點的字元編號 */
  readonly trieVia: Int32Array
  /** target 長度（依 target 編號） */
  readonly targetLength: Int32Array
  /** 空字串 target（脫落規則）的編號；沒有則為 -1 */
  readonly emptyTarget: number

  /**
   * @param rules 已正規化、已展開反向的規則
   * @param boundaries 詞邊界字元（預設為空白）
   */
  constructor(rules: Rule[], boundaries: Set<string>) {
    this.boundaries = boundaries

    // ── target：去重、編號，target 的字元最先編號 ──
    const targetIds = new Map<string, number>()
    for (const r of rules) {
      if (!targetIds.has(r.target)) {
        targetIds.set(r.target, this.targets.length)
        this.targets.push(r.target)
      }
    }
    for (const t of this.targets) for (const ch of t) this.idOf(ch)
    this.trieWidth = Math.max(1, this.chars.length)

    this.rules = rules.map((r) => ({
      ...r,
      junction: Boolean(r.junction),
      sourceLength: Array.from(r.source).length,
      targetLength: Array.from(r.target).length,
      targetId: targetIds.get(r.target) as number,
      sourceBoundary: Array.from(r.source).some((ch) => boundaries.has(ch)),
    }))
    for (const rule of this.rules) {
      const list = this.bySource.get(rule.source)
      if (list) list.push(rule)
      else this.bySource.set(rule.source, [rule])
    }
    this.sourceLengths = uniqueSorted(this.rules.map((r) => r.sourceLength))
    this.targetLengths = uniqueSorted(this.rules.map((r) => r.targetLength))
    this.maxTargetLength = Math.max(1, ...this.targetLengths)

    // ── target trie ──
    const child: number[] = []
    const depth: number[] = [0]
    const targetAt: number[] = [-1]
    const jump: number[] = [Infinity]
    const parent: number[] = [-1]
    const via: number[] = [-1]
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
          parent.push(s)
          via.push(c)
          for (let k = 0; k < width; k++) child.push(-1)
          child[s * width + c] = next
        }
        s = next
      }
      targetAt[s] = T
    })
    // jump：對每條規則，target 的每個「真前綴」節點（深度 1 … |t|-1）取最小權重
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
    this.trieParent = Int32Array.from(parent)
    this.trieVia = Int32Array.from(via)
    this.targetLength = Int32Array.from(this.targets, (t) => Array.from(t).length)
    this.emptyTarget = targetIds.get('') ?? -1
  }

  /**
   * 字元的編號；第一次見到的字元依序給新編號。
   * @param ch 單一 code point
   */
  idOf(ch: string): number {
    let id = this._ids.get(ch)
    if (id === undefined) {
      id = this.chars.length
      this._ids.set(ch, id)
      this.chars.push(ch)
      this._boundaryById.push(this.boundaries.has(ch) ? 1 : 0)
    }
    return id
  }

  isBoundaryId(id: number): boolean {
    return this._boundaryById[id] === 1
  }

  isBoundary(ch: string | undefined): boolean {
    return ch !== undefined && this.boundaries.has(ch)
  }

  /** target trie 節點代表的字串（由根到這個節點）。 */
  trieString(node: number): string {
    const out: string[] = []
    for (let s = node; s > 0; s = this.trieParent[s]) out.push(this.chars[this.trieVia[s]])
    return out.reverse().join('')
  }

  /** 由 node 沿著字元 chars 往下走；走不下去時回傳 -1。 */
  trieWalk(node: number, chars: Iterable<string>): number {
    let s = node
    for (const ch of chars) {
      const c = this.idOf(ch)
      if (c >= this.trieWidth) return -1
      s = this.trieChild[s * this.trieWidth + c]
      if (s === -1) return -1
    }
    return s
  }

  /**
   * 為查詢字串建立成本表與規則表。
   * @param x 查詢字串（code point 陣列）
   */
  compileQuery(x: string[], costs: CostModel, options: QueryOptions = {}): QueryPlan {
    const n = x.length
    const { start = null, junctions = false, lockBoundary = false } = options
    const ids = Int32Array.from(x, (ch) => this.idOf(ch))
    const del = new Float64Array(n + 1)
    for (let i = 1; i <= n; i++) del[i] = lockBoundary && this.isBoundary(x[i - 1]) ? Infinity : costs.del(x[i - 1])
    const junctionMask = new Uint8Array(n + 1)
    for (let i = 0; i <= n; i++) if ((i > 0 && this.isBoundary(x[i - 1])) || (i < n && this.isBoundary(x[i]))) junctionMask[i] = 1

    // 先依出現順序收集，再依 target 做穩定的計數排序：桶內的順序是 i 遞增；同一個 i 依 source 長度遞增、
    // 再依規則原本的順序。追蹤模式依這個順序回報，所以 explain 的結果是固定的。
    const foundI: number[] = []
    const foundRule: CompiledRule[] = []
    /** 每條規則在這個位置的旗標 */
    const foundFlag: number[] = []
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
          if (rule.junction && !junctions) continue // 構詞音變只在詞素交界適用
          if (lockBoundary && rule.sourceBoundary) continue
          // X 側的位置條件。不成立時，只有 Y 側在詞素交界才可以用（構詞音變本來就只看交界，不檢查 X 側）
          const xfail =
            !rule.junction &&
            ((rule.position === 'initial' && !(i - a === 0 || this.isBoundary(x[i - a - 1]))) ||
              (rule.position === 'final' && !(i === n || this.isBoundary(x[i]))))
          if (xfail && !junctions) continue
          if (rule.position === 'final' && !xfail && !rule.junction) hasFinal = true
          foundI.push(i)
          foundRule.push(rule)
          foundFlag.push(
            (rule.position === 'final' ? FLAG_FINAL : 0) |
              (rule.position === 'initial' ? FLAG_INITIAL : 0) |
              (xfail ? FLAG_XFAIL : 0) |
              (rule.junction ? FLAG_JUNCTION : 0) |
              (junctions && rule.sourceBoundary ? FLAG_BSRC : 0),
          )
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
    const ruleRef: CompiledRule[] = new Array(total)
    for (let e = 0; e < total; e++) {
      const rule = foundRule[e]
      const k = cursor[rule.targetId]++
      ruleI[k] = foundI[e]
      ruleSrc[k] = rule.sourceLength
      ruleW[k] = rule.weight
      ruleFlag[k] = foundFlag[e]
      ruleRef[k] = rule
    }

    // 本段路徑上的 target（≤ maxTargetLength 個）＋從前一段延續過來、跨越交界的 target
    const cap = 2 * (this.maxTargetLength + 1)
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
      junctionMask,
      lockBoundary,
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
        emptyInitial: EDGE_NONE,
      },
    }
  }
}

/**
 * 查詢 X 對候選字元 y 的替換成本列：row[i] = sub(X[i-1], y)。第一次用到 y 時才算。
 * @param y 字元編號
 */
function subRowOf(plan: QueryPlan, compiled: CompiledRules, y: number): Float64Array {
  let row = plan.subRows[y]
  if (row === undefined) {
    row = new Float64Array(plan.n + 1)
    const ch = compiled.chars[y]
    for (let i = 1; i <= plan.n; i++) {
      row[i] = plan.lockBoundary && compiled.isBoundary(plan.chars[i - 1]) ? Infinity : plan.costs.sub(plan.chars[i - 1], ch)
    }
    plan.subRows[y] = row
  }
  return row
}

/** ins(y)，第一次用到 y 時才查成本表。 */
function insOf(plan: QueryPlan, compiled: CompiledRules, y: number): number {
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
  readonly compiled: CompiledRules
  /** 每層最多幾個狀態：深度 1 … maxTargetLength */
  readonly cap: number
  /** ids[r] = Y[r] 的字元編號 */
  ids!: Int32Array
  /** boundary[r] = Y[r] 是否為邊界字元；決定引用第 r 列時用 F_r 還是 N_r */
  boundary!: Uint8Array
  /** 第 j 層的狀態：states[j * cap + k]，k < counts[j] */
  states!: Int32Array
  counts!: Int32Array

  constructor(compiled: CompiledRules) {
    this.compiled = compiled
    this.cap = compiled.maxTargetLength
    this._grow(32)
  }

  /** @param size 可容納的最大深度 */
  private _grow(size: number): void {
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
    this.ids = ids
    this.boundary = boundary
    this.states = states
    this.counts = counts
  }

  /**
   * 設定 Y[j-1] = 字元 y，並算出第 j 層的狀態集合（j ≥ 1；第 0 層恆為空）。
   * @param y 字元編號
   */
  set(j: number, y: number): void {
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
 * 計算第 j 列所需、與 allowFinal 無關的準備資料。N_j 與 F_j 共用同一份，只準備一次。
 * 物件本身存放在 QueryPlan 上重複使用（fillRow 不會遞迴，所以不會互相覆寫）。
 */
export interface ColumnContext {
  j: number
  /** Y[j-1] 的字元編號（j = 0 時為 -1） */
  y: number
  /** 第 j-1 列的實際數值 */
  prevRow: Float64Array | null
  /** 本列匹配到、且在 X 中有規則的非空 target 個數 */
  count: number
  /** targets[k]：target 編號（依長度遞增） */
  targets: Int32Array
  /** lengths[k]：target 長度 t */
  lengths: Int32Array
  /** rows[k]：規則轉移的來源列（第 j − t 列；跨界時是前一段的列） */
  rows: Array<Float64Array | null>
  /** initial[k]：該 target 起點的位置種類（EDGE_*） */
  initial: Uint8Array
  /** 空字串 target 所在位置 j 的位置種類（EDGE_NONE／EDGE_WORD／EDGE_JUNCTION） */
  emptyInitial: number
}

/** 從前一段延續過來、還沒走完的規則 target（跨越詞素交界）。第 j 層的狀態由第 j − 1 層沿 Y[j-1] 往下走得到。 */
export interface Crossing {
  count: number
  /** target trie 的節點（深度 ＝ 前一段的部分 ＋ j） */
  nodes: Int32Array
  /** 這個 target 起點那一列（在前一段） */
  rows: Float64Array[]
  /** 各列的最小值（剪枝用） */
  mins: Float64Array
}

/**
 * 準備第 j 列的共用資料。
 * @param path 已設定到第 j 層的路徑匹配器
 * @param rowAt 取得先前第 row 列（row < j）的「實際」數值
 * @param startEdge 這一段的起點（Y 的位置 0）是詞首還是詞素交界
 * @param cross 第 j 層、跨越交界的 target 狀態
 */
export function prepareColumn(
  plan: QueryPlan,
  compiled: CompiledRules,
  path: PathMatcher,
  j: number,
  rowAt: (row: number) => Float64Array,
  startEdge: number = EDGE_WORD,
  cross: Crossing | null = null,
): ColumnContext {
  const ctx = plan.column
  ctx.j = j
  ctx.y = j > 0 ? path.ids[j - 1] : -1
  ctx.prevRow = j > 0 ? rowAt(j - 1) : null
  ctx.emptyInitial = j === 0 ? startEdge : path.boundary[j - 1] === 1 ? EDGE_WORD : EDGE_NONE

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
    ctx.initial[count] = j - t === 0 ? startEdge : path.boundary[j - t - 1] === 1 ? EDGE_WORD : EDGE_NONE
    count++
  }
  // 跨越交界的 target（依長度遞增接在後面：它們都比 j 長）
  if (cross) {
    if (count + cross.count > ctx.targets.length) growColumn(ctx, count + cross.count)
    for (let k = 0; k < cross.count; k++) {
      const s = cross.nodes[k]
      const T = compiled.trieTarget[s]
      if (T === -1 || ruleOff[T + 1] === ruleOff[T]) continue
      ctx.targets[count] = T
      ctx.lengths[count] = compiled.trieDepth[s]
      ctx.rows[count] = cross.rows[k]
      ctx.initial[count] = EDGE_CROSS
      count++
    }
  }
  ctx.count = count
  return ctx
}

/**
 * 第 j 列的剪枝下界中「跨列」的部分：min over 狀態 s ∈ 第 j 層 of min(第 j − depth(s) 列) + jump(s)。
 * 第 r 列要跨過第 j 列，唯一的方式是一條 target 以 Y[r..j) 開頭、且比它更長的規則。
 * 跨越交界的狀態同理，來源列在前一段。
 * @param minAt 第 r 列（依 Y[r] 選 N／F）的最小值
 */
export function jumpBound(compiled: CompiledRules, path: PathMatcher, j: number, minAt: (r: number) => number, cross: Crossing | null = null): number {
  let bound = Infinity
  const base = j * path.cap
  for (let k = 0; k < path.counts[j]; k++) {
    const s = path.states[base + k]
    const jump = compiled.trieJump[s]
    if (jump === Infinity) continue
    const v = minAt(j - compiled.trieDepth[s]) + jump
    if (v < bound) bound = v
  }
  if (cross) {
    for (let k = 0; k < cross.count; k++) {
      const jump = compiled.trieJump[cross.nodes[k]]
      if (jump === Infinity) continue
      const v = cross.mins[k] + jump
      if (v < bound) bound = v
    }
  }
  return bound
}

/** 由第 j − 1 層的跨界狀態沿 Y[j-1]（字元編號 y）往下走，得到第 j 層的跨界狀態（寫進 out）。 */
export function advanceCrossing(compiled: CompiledRules, prev: Crossing, y: number, out: Crossing): Crossing {
  let count = 0
  if (y < compiled.trieWidth) {
    for (let k = 0; k < prev.count; k++) {
      const next = compiled.trieChild[prev.nodes[k] * compiled.trieWidth + y]
      if (next === -1) continue
      out.nodes[count] = next
      out.rows[count] = prev.rows[k]
      out.mins[count] = prev.mins[k]
      count++
    }
  }
  out.count = count
  return out
}

/** 擴充列的暫存（合併了很多前綴鏈的交界狀態，跨界的 target 可能多於一條路徑上的）。 */
function growColumn(ctx: ColumnContext, size: number): void {
  const grow = <A extends Int32Array | Uint8Array>(a: A, b: A): A => (b.set(a), b)
  ctx.targets = grow(ctx.targets, new Int32Array(size))
  ctx.lengths = grow(ctx.lengths, new Int32Array(size))
  ctx.initial = grow(ctx.initial, new Uint8Array(size))
  ctx.rows.length = size
}

/** 建立跨界狀態的容器（容量 capacity）。 */
export function createCrossing(capacity: number): Crossing {
  return { count: 0, nodes: new Int32Array(capacity), rows: new Array(capacity), mins: new Float64Array(capacity) }
}

export type Operation = 'match' | 'substitute' | 'delete' | 'insert' | 'rule'

/** fillRow 在追蹤模式下回報的每一個候選轉移 */
export interface Transition {
  i: number
  j: number
  fromI: number
  fromJ: number
  /** 到達 (i, j) 的總成本 */
  cost: number
  /** 這一步本身的成本 */
  stepCost: number
  op: Operation
  rule: CompiledRule | null
}

/**
 * 計算第 j 列，回傳這一列的最小值（剪枝用）。
 *
 * @param plan 查詢的成本表與規則表
 * @param ctx prepareColumn 的結果
 * @param allowFinal Y 在位置 j 之後是什麼：false／EDGE_NONE 下一字元不是邊界（N_j）、
 *   true／EDGE_WORD 詞尾（F_j）、EDGE_JUNCTION 詞素交界（交界列；見檔頭說明）
 * @param out 輸出，長度至少 N + 1
 * @param trace 追蹤模式：回報每個候選轉移（視覺化用）
 * @returns min(out[0..N])
 */
export function fillRow(
  plan: QueryPlan,
  compiled: CompiledRules,
  ctx: ColumnContext,
  allowFinal: boolean | number,
  out: Float64Array,
  trace: ((t: Transition) => void) | null = null,
): number {
  if (trace) return fillRowTraced(plan, compiled, ctx, allowFinal, out, trace)
  const n = plan.n
  const { j, prevRow } = ctx
  const del = plan.del
  const { ruleI, ruleSrc, ruleW, ruleFlag } = plan
  const fin = +allowFinal

  // ① 來源在較早的列（target 非空）的規則轉移：先整批算進暫存列 ruleMin。
  //    這些轉移只讀較早的列，與本列的計算順序無關，可以提前算好。
  let hasRules = false
  const ruleMin = plan.ruleMin
  if (ctx.count > 0) {
    ruleMin.fill(Infinity)
    for (let k = 0; k < ctx.count; k++) {
      const T = ctx.targets[k]
      const predRow = ctx.rows[k] as Float64Array
      const startEdge = ctx.initial[k]
      for (let p = plan.ruleOff[T]; p < plan.ruleOff[T + 1]; p++) {
        const flag = ruleFlag[p]
        if (flag !== 0 && !admissible(flag, startEdge, fin)) continue
        const i = ruleI[p]
        const c = predRow[i - ruleSrc[p]] + ruleW[p]
        if (c < ruleMin[i]) ruleMin[i] = c
      }
    }
    hasRules = true
  }

  // ② 空字串 target（脫落規則）的來源是同一列較小的 i，要在主迴圈中依 i 順序處理。
  //    交界列上，位置 j 同時是前一個詞素的結尾與下一個詞素的開頭
  const E = compiled.emptyTarget
  let p = E === -1 ? 0 : plan.ruleOff[E]
  const pEnd = E === -1 ? 0 : plan.ruleOff[E + 1]
  const junctionRow = fin === EDGE_JUNCTION || ctx.emptyInitial === EDGE_JUNCTION
  const emptyStart = fin === EDGE_JUNCTION ? EDGE_JUNCTION : ctx.emptyInitial
  const emptyEnd = junctionRow ? EDGE_JUNCTION : fin
  // 交界列上 X 的切點不能在空白旁（構詞不跨越空白）
  const mask = junctionRow ? plan.junctionMask : null

  // ③ 主迴圈
  const start = plan.start
  const subRow = prevRow ? subRowOf(plan, compiled, ctx.y) : null
  const insertCost = prevRow ? insOf(plan, compiled, ctx.y) : 0
  let min = Infinity
  for (let i = 0; i <= n; i++) {
    // 起點：預設 D(0, 0) = 0；有起點列（前一段的交界列）時第 0 列的每一格都可以是起點
    let best = j === 0 ? (start ? start[i] : i === 0 ? 0 : Infinity) : Infinity
    if (prevRow) {
      const c1 = prevRow[i] + insertCost // 插入 Y[j-1]
      if (c1 < best) best = c1
      if (i > 0) {
        const c2 = prevRow[i - 1] + (subRow as Float64Array)[i] // 替換／相同
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
      if (flag !== 0 && (!admissible(flag, emptyStart, emptyEnd) || (flag & FLAG_BSRC && junctionRow))) continue
      const c4 = out[i - ruleSrc[p]] + ruleW[p]
      if (c4 < best) best = c4
    }
    if (mask !== null && mask[i] === 1) best = Infinity
    out[i] = best
    if (best < min) min = best
  }
  return min
}

/**
 * fillRow 的追蹤版本：逐格回報每一個候選轉移。
 * 回報順序固定：插入、替換、刪除，再依 target 長度遞增回報規則
 * （同一 target 內依規則在 compileQuery 中的順序），所以 explain 在同分時選到的轉移是固定的。
 */
function fillRowTraced(
  plan: QueryPlan,
  compiled: CompiledRules,
  ctx: ColumnContext,
  allowFinal: boolean | number,
  out: Float64Array,
  trace: (t: Transition) => void,
): number {
  const n = plan.n
  const { j, prevRow } = ctx
  const { ruleOff, ruleI, ruleSrc, ruleW, ruleFlag, ruleRef } = plan
  const subRow = prevRow ? subRowOf(plan, compiled, ctx.y) : null
  const insertCost = prevRow ? insOf(plan, compiled, ctx.y) : 0
  const fin = +allowFinal
  const junctionRow = fin === EDGE_JUNCTION || ctx.emptyInitial === EDGE_JUNCTION
  const mask = junctionRow ? plan.junctionMask : null
  /** 依 target 長度遞增：空字串 target（長度 0）在最前面 */
  const order: Array<{ T: number; t: number; row: Float64Array | null; start: number; end: number }> = []
  if (compiled.emptyTarget !== -1) {
    order.push({ T: compiled.emptyTarget, t: 0, row: null, start: fin === EDGE_JUNCTION ? EDGE_JUNCTION : ctx.emptyInitial, end: junctionRow ? EDGE_JUNCTION : fin })
  }
  for (let k = 0; k < ctx.count; k++) {
    order.push({ T: ctx.targets[k], t: ctx.lengths[k], row: ctx.rows[k], start: ctx.initial[k], end: fin })
  }
  let min = Infinity
  for (let i = 0; i <= n; i++) {
    let best = j === 0 ? (plan.start ? plan.start[i] : i === 0 ? 0 : Infinity) : Infinity
    if (prevRow) {
      const c1 = prevRow[i] + insertCost
      if (c1 < best) best = c1
      trace({ i, j, fromI: i, fromJ: j - 1, cost: c1, stepCost: insertCost, op: 'insert', rule: null })
      if (i > 0) {
        const subCost = (subRow as Float64Array)[i]
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
    for (const { T, t, row, start, end } of order) {
      const predRow = row ?? out
      for (let p = ruleOff[T]; p < ruleOff[T + 1]; p++) {
        if (ruleI[p] !== i) continue
        const flag = ruleFlag[p]
        if (flag !== 0 && !admissible(flag, start, end)) continue
        if (flag & FLAG_BSRC && t === 0 && junctionRow) continue
        const c4 = predRow[i - ruleSrc[p]] + ruleW[p]
        if (c4 < best) best = c4
        trace({ i, j, fromI: i - ruleSrc[p], fromJ: j - t, cost: c4, stepCost: ruleW[p], op: 'rule', rule: ruleRef[p] })
      }
    }
    if (mask !== null && mask[i] === 1) best = Infinity
    out[i] = best
    if (best < min) min = best
  }
  return min
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}
