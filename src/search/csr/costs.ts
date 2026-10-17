/**
 * @file 對應組檢索的成本：音段的格、每對方言的成本表、學出的音類、加權 DP（docs/csr.md 第 3 節）。
 *
 * 計數：c_ab(s, w) ＝ 模型中 a 方言的反映形是 s、b 方言是 w 的欄數總和（缺口是空字串；至少 minSites 欄的對應組），
 * 加上手寫規則的先驗（規則的每個段層級編輯，兩個方向各 priorSites 欄）。
 * 成本：w 非空時 −log((c(s, w) ＋ β[s = w]) ／ (Σ_w′ c(s, w′) ＋ β))，s 可以是空字串（b 多出 w）；
 * w 是空字串時（a 多出 s）−log(c(s, ∅) ／ Σ_w′ c(s, w′))。沒有計數的對應是 ∞，只能以「打錯」（刪除、插入各 typo）處理。
 * 同一個方言（a ＝ b）的表只有「兩邊相同」（成本 0），其他差異都算打錯。
 */

/** 音段清單、編號與切段 */
export interface Inventory {
  /** 第 0 個是空字串 */
  forms: string[]
  id: Map<string, number>
  F: number
  /** 最長的音段（code point） */
  maxL: number
  /**
   * 切段的格：第 i 格的第 l 項是「從 i 開始、長 l 的子字串」的音段編號（不是音段時為 −1）；
   * 最後多一格（字串結尾），DP 由這張格取所有切法
   */
  tokenize: (s: string) => Int32Array[]
  /** 最長匹配的切段（規則字串、索引的鍵用） */
  segment: (s: string) => string[]
}

export function inventoryOf(segments: Iterable<string>): Inventory {
  const forms = ['', ...new Set([...segments].filter((f) => f !== ''))]
  const id = new Map(forms.map((f, k) => [f, k]))
  const maxL = Math.max(1, ...forms.map((f) => Array.from(f).length))
  const tokenize = (s: string): Int32Array[] => {
    const ch = Array.from(s)
    return ch.concat(['']).map((_, i) => {
      const out = new Int32Array(maxL + 1).fill(-1)
      for (let l = 0; l <= maxL && i + l <= ch.length; l++) out[l] = id.get(ch.slice(i, i + l).join('')) ?? -1
      return out
    })
  }
  const segment = (s: string): string[] => {
    const ch = Array.from(s)
    const out: string[] = []
    for (let i = 0; i < ch.length; ) {
      let l = Math.min(maxL, ch.length - i)
      while (l > 1 && !id.has(ch.slice(i, i + l).join(''))) l--
      out.push(ch.slice(i, i + l).join(''))
      i += l
    }
    return out
  }
  return { forms, id, F: forms.length, maxL, tokenize, segment }
}

/** 兩個段序列之間的最少編輯（Levenshtein 回溯；同分時先取替換）：[a 的段或 ''，b 的段或 ''] */
export function segmentEdits(a: string[], b: string[]): Array<[string, string]> {
  const n = a.length, m = b.length
  const D = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), D[i - 1][j] + 1, D[i][j - 1] + 1)
  const out: Array<[string, string]> = []
  for (let i = n, j = m; i > 0 || j > 0; ) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1]) out.push([a[i - 1], b[j - 1]])
      i--
      j--
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) out.push([a[--i], ''])
    else out.push(['', b[--j]])
  }
  return out.reverse()
}

export interface CostOptions {
  dialects: string[]
  inventory: Inventory
  patterns: Array<{ reflexes: Record<string, string>; sites: number }>
  /** 手寫規則（語言設定檔 rules 攤平後的兩邊），當作先驗 */
  rules: Array<{ source: string; target: string }>
  minSites: number
  beta: number
  priorSites: number
}

/** 每對方言的成本表：costs[a · N ＋ b][s · F ＋ w]（a ＝ b 是同一方言的表） */
export function buildCostTables({ dialects, inventory, patterns, rules, minSites, beta, priorSites }: CostOptions): Float64Array[] {
  const { F, id } = inventory
  const N = dialects.length
  const C = Array.from({ length: N * N }, () => new Float64Array(F * F))
  const add = (a: number, b: number, x: string, y: string, n: number) => {
    const s = id.get(x), w = id.get(y)
    if (s === undefined || w === undefined || (s === 0 && w === 0)) return
    C[a * N + b][s * F + w] += n
  }
  for (const p of patterns) {
    if (p.sites < minSites) continue
    for (let a = 0; a < N; a++)
      for (let b = 0; b < N; b++) {
        if (a === b) continue
        const ra = p.reflexes[dialects[a]], rb = p.reflexes[dialects[b]]
        if (ra === undefined || rb === undefined) continue
        add(a, b, ra === '-' ? '' : ra, rb === '-' ? '' : rb, p.sites)
      }
  }
  if (priorSites > 0) {
    const edits = new Set<string>()
    for (const r of rules)
      for (const [x, y] of segmentEdits(inventory.segment(r.source), inventory.segment(r.target))) {
        edits.add(`${x}\u0000${y}`)
        edits.add(`${y}\u0000${x}`)
      }
    for (const e of edits) {
      const [x, y] = e.split('\u0000')
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (a !== b) add(a, b, x, y, priorSites)
    }
  }
  return C.map((c, k) => {
    const cost = new Float64Array(F * F).fill(Infinity)
    if (Math.floor(k / N) === k % N) {
      // 同一個方言：只有兩邊相同
      for (let s = 1; s < F; s++) cost[s * F + s] = 0
      return cost
    }
    for (let s = 0; s < F; s++) {
      let row = 0
      for (let w = 0; w < F; w++) row += c[s * F + w]
      for (let w = 0; w < F; w++) {
        const same = s === w && s > 0 ? beta : 0
        if (c[s * F + w] + same > 0) cost[s * F + w] = -Math.log((c[s * F + w] + same) / (row + (s > 0 ? beta : 0)))
      }
    }
    return cost
  })
}

/**
 * 學出的音類：任何一對不同方言中 cost ≤ −log(p) 的兩個音段以 union-find 合併（空字串不參與）。
 * @returns 音段編號 → 類別代表的編號
 */
export function soundClasses(tables: Float64Array[], N: number, F: number, p: number): Int32Array {
  const parent = Int32Array.from({ length: F }, (_, k) => k)
  const find = (v: number): number => (parent[v] === v ? v : (parent[v] = find(parent[v])))
  const gamma = -Math.log(p)
  for (let a = 0; a < N; a++)
    for (let b = 0; b < N; b++) {
      if (a === b) continue
      const t = tables[a * N + b]
      for (let s = 1; s < F; s++) for (let w = 1; w < F; w++) if (t[s * F + w] <= gamma) parent[find(s)] = find(w)
    }
  return Int32Array.from({ length: F }, (_, k) => find(k))
}

/** 對齊的一步：source 是查詢的音段、target 是詞條的音段（空字串是缺口） */
export interface CsrStep {
  source: string
  target: string
  cost: number
  /** match 兩邊相同、correspondence 學到的對應、edit 打錯（表中沒有的差異） */
  kind: 'match' | 'correspondence' | 'edit'
}

/**
 * 加權 DP（tropical 半環：取最小、成本相加）。查詢與詞條都以「格」表示，所有切法一起比；
 * 另外容許「打錯」：刪除查詢的一個字元或插入一個字元，各付 typo。
 */
export function createAligner(inventory: Inventory) {
  const { F, maxL, forms } = inventory
  let buf = new Float64Array(256)
  const fill = (xs: Int32Array[], ys: Int32Array[], cost: Float64Array, typo: number, bound: number) => {
    const n = xs.length - 1, m = ys.length - 1, W = m + 1
    if (buf.length < (n + 1) * W) buf = new Float64Array(2 * (n + 1) * W)
    const D = buf
    D.fill(Infinity, 0, (n + 1) * W)
    D[0] = 0
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= m; j++) {
        const d0 = D[i * W + j]
        if (d0 === Infinity || d0 > bound) continue
        for (let ls = 0; ls <= maxL && i + ls <= n; ls++) {
          const s = xs[i][ls]
          if (s < 0) continue
          for (let lw = 0; lw <= maxL && j + lw <= m; lw++) {
            if (ls + lw === 0) continue
            const w = ys[j][lw]
            if (w < 0) continue
            const v = d0 + cost[s * F + w]
            if (v < D[(i + ls) * W + j + lw]) D[(i + ls) * W + j + lw] = v
          }
        }
        if (typo) {
          if (i < n && d0 + typo < D[(i + 1) * W + j]) D[(i + 1) * W + j] = d0 + typo
          if (j < m && d0 + typo < D[i * W + j + 1]) D[i * W + j + 1] = d0 + typo
        }
      }
    return { D, n, m, W }
  }
  /** 距離；超過 bound 的格不再往下算（結果大於 bound 時可能不精確，但一定大於 bound） */
  const distance = (xs: Int32Array[], ys: Int32Array[], cost: Float64Array, typo: number, bound = Infinity): number => {
    const { D, n, W, m } = fill(xs, ys, cost, typo, bound)
    return D[n * W + m]
  }
  /** 最好的對齊（由終點回溯）；查詢與詞條是原本的字串，用來取出每一步的子字串 */
  const align = (q: string, e: string, cost: Float64Array, typo: number): CsrStep[] => {
    const xs = inventory.tokenize(q), ys = inventory.tokenize(e)
    const { D, n, m, W } = fill(xs, ys, cost, typo, Infinity)
    const qc = Array.from(q), ec = Array.from(e)
    const steps: CsrStep[] = []
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
    for (let i = n, j = m; i > 0 || j > 0; ) {
      const here = D[i * W + j]
      let moved = false
      if (typo && i > 0 && near(D[(i - 1) * W + j] + typo, here)) {
        steps.push({ source: qc[i - 1], target: '', cost: typo, kind: 'edit' })
        i--
        continue
      }
      if (typo && j > 0 && near(D[i * W + j - 1] + typo, here)) {
        steps.push({ source: '', target: ec[j - 1], cost: typo, kind: 'edit' })
        j--
        continue
      }
      for (let ls = 0; ls <= maxL && ls <= i && !moved; ls++)
        for (let lw = 0; lw <= maxL && lw <= j && !moved; lw++) {
          if (ls + lw === 0) continue
          const s = xs[i - ls][ls], w = ys[j - lw][lw]
          if (s < 0 || w < 0) continue
          const c = cost[s * F + w]
          if (c !== Infinity && near(D[(i - ls) * W + j - lw] + c, here)) {
            steps.push({ source: forms[s], target: forms[w], cost: c, kind: s === w ? 'match' : 'correspondence' })
            i -= ls
            j -= lw
            moved = true
          }
        }
      if (!moved) break
    }
    return steps.reverse()
  }
  return { distance, align }
}
