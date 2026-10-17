/**
 * @file 對應組檢索的成本：音段的格、每對方言的成本表與前後文單位、學出的音類、加權 DP（docs/csr.md 第 3 節）。
 *
 * 語音對應全部來自模型（由資料學出）；語言設定檔的方言規則不參與。
 *
 * 單一音段的對應（稠密表）：c_ab(s, w) ＝ 模型中 a 方言的反映形是 s、b 方言是 w 的欄數總和
 * （缺口是空字串；至少 minSites 欄的對應組）。
 * 成本：w 非空時 −log((c(s, w) ＋ β[s = w]) ／ (Σ_w′ c(s, w′) ＋ β))，s 可以是空字串（b 多出 w）；
 * w 是空字串時（a 多出 s）−log(c(s, ∅) ／ Σ_w′ c(s, w′))。沒有計數的對應是 ∞，只能以「打錯」（刪除、插入各 typo）處理。
 *
 * 前後文單位（每對方言一張稀疏表）：a 方言的字串 x 對到 b 方言的字串 y，可以限定在詞首或詞尾。
 * 成本 −log(c(x, y) ／ n_a(x))，n_a(x) 是 x 在 a 方言的對齊資料中出現的次數（模型的 occurrences；對應組的 of 優先）。
 * 例如 u 在 h 之前才對到 o（uh → oh）：DP 中兩邊同時是 uh、oh 時才能整段一起換，單獨的 u → o 仍是稠密表的成本。
 *
 * 同一個方言（a ＝ b）只有「兩邊相同」（成本 0），其他差異都算打錯，也沒有前後文單位。
 */

import { isContextPattern, occurrenceKey, type CsrPattern } from './model.ts'

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
  /** 最長匹配的切段（索引的鍵用） */
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

export interface CostOptions {
  dialects: string[]
  inventory: Inventory
  patterns: CsrPattern[]
  minSites: number
  beta: number
}

/** 每對方言的成本表（單一音段的對應）：costs[a · N ＋ b][s · F ＋ w]（a ＝ b 是同一方言的表）；前後文單位不在這裡 */
export function buildCostTables({ dialects, inventory, patterns, minSites, beta }: CostOptions): Float64Array[] {
  const { F, id } = inventory
  const N = dialects.length
  const C = Array.from({ length: N * N }, () => new Float64Array(F * F))
  const segments = new Set(inventory.forms)
  for (const p of patterns) {
    if (p.sites < minSites || isContextPattern(p, segments)) continue
    for (let a = 0; a < N; a++)
      for (let b = 0; b < N; b++) {
        if (a === b) continue
        const ra = p.reflexes[dialects[a]], rb = p.reflexes[dialects[b]]
        if (ra === undefined || rb === undefined) continue
        const s = id.get(ra === '-' ? '' : ra), w = id.get(rb === '-' ? '' : rb)
        if (s === undefined || w === undefined || (s === 0 && w === 0)) continue
        C[a * N + b][s * F + w] += p.sites
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

/** 一個前後文單位（某一對方言的方向）：source 是查詢方言的字串、target 是詞條方言的字串 */
export interface ContextUnit {
  source: string
  target: string
  /** source、target 的字元（code point） */
  s: string[]
  t: string[]
  position: 'initial' | 'final' | null
  cost: number
}

/** 每對方言的前後文單位，依來源字串的第一個字元分組（來源是空字串的另外放） */
export interface ContextTable {
  byFirst: Map<string, ContextUnit[]>
  inserts: ContextUnit[]
  size: number
}

export interface ContextOptions {
  dialects: string[]
  segments: ReadonlySet<string>
  patterns: CsrPattern[]
  occurrences: Record<string, Record<string, number>> | undefined
  minSites: number
  /** 與詞庫相同的正規化（搜尋鍵） */
  normalize: (s: string) => string
}

/** 每對方言的前後文單位表：tables[a · N ＋ b]（a ＝ b 的表是空的）。缺出現次數的單位不用（validateCsrModel 會報錯） */
export function buildContextTables({ dialects, segments, patterns, occurrences, minSites, normalize }: ContextOptions): ContextTable[] {
  const N = dialects.length
  const tables = Array.from({ length: N * N }, (): ContextTable => ({ byFirst: new Map(), inserts: [], size: 0 }))
  for (const p of patterns) {
    if (p.sites < minSites || !isContextPattern(p, segments)) continue
    for (let a = 0; a < N; a++)
      for (let b = 0; b < N; b++) {
        if (a === b) continue
        const ra = p.reflexes[dialects[a]], rb = p.reflexes[dialects[b]]
        if (ra === undefined || rb === undefined) continue
        const x = ra === '-' ? '' : ra, y = rb === '-' ? '' : rb
        const n = p.of?.[dialects[a]] ?? occurrences?.[dialects[a]]?.[occurrenceKey(x, p.position)]
        if (n === undefined) continue
        const source = normalize(x), target = normalize(y)
        if (source === '' && target === '') continue
        const unit: ContextUnit = { source, target, s: Array.from(source), t: Array.from(target), position: p.position ?? null, cost: -Math.log(Math.min(1, p.sites / Math.max(n, p.sites))) }
        const table = tables[a * N + b]
        if (source === '') table.inserts.push(unit)
        else {
          let list = table.byFirst.get(unit.s[0])
          if (!list) table.byFirst.set(unit.s[0], (list = []))
          list.push(unit)
        }
        table.size++
      }
  }
  return tables
}

/** 查詢（字元）每個位置開頭的前後文單位：第 i 項是來源字串在 i 開頭、位置條件在查詢這一邊成立的單位 */
export function contextMatches(chars: readonly string[], table: ContextTable): ContextUnit[][] {
  const n = chars.length
  const out: ContextUnit[][] = []
  for (let i = 0; i <= n; i++) {
    const here: ContextUnit[] = []
    for (const u of [...(table.byFirst.get(chars[i]) ?? []), ...table.inserts]) {
      if (i + u.s.length > n) continue
      if (u.position === 'initial' && i !== 0) continue
      if (u.position === 'final' && i + u.s.length !== n) continue
      let ok = true
      for (let k = 1; k < u.s.length && ok; k++) ok = chars[i + k] === u.s[k]
      if (ok) here.push(u)
    }
    out.push(here)
  }
  return out
}

/** 詞條在 j 開頭是不是單位的目標（位置條件在詞條這一邊也要成立） */
function targetAt(u: ContextUnit, e: readonly string[], j: number): boolean {
  const m = e.length
  if (j + u.t.length > m) return false
  if (u.position === 'initial' && j !== 0) return false
  if (u.position === 'final' && j + u.t.length !== m) return false
  for (let k = 0; k < u.t.length; k++) if (e[j + k] !== u.t[k]) return false
  return true
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

/** 對齊的一步：source 是查詢的字串、target 是詞條的字串（空字串是缺口） */
export interface CsrStep {
  source: string
  target: string
  cost: number
  /** match 兩邊相同、correspondence 學到的對應、context 學到的前後文單位、edit 打錯（表中沒有的差異） */
  kind: 'match' | 'correspondence' | 'context' | 'edit'
  /** 前後文單位只在詞首、詞尾成立時 */
  position?: 'initial' | 'final'
  /**
   * 前後文單位「拆開來看」：同一段若逐音段以單一音段的對應比對，是哪幾步、各多少（CorrespondenceSearch.explain 填）。
   * 只是對照，不表示演變的先後
   */
  parts?: CsrStep[]
}

/** DP 的一邊：切段的格與字元 */
export interface AlignSide {
  lattice: Int32Array[]
  chars: readonly string[]
}

/**
 * 加權 DP（tropical 半環：取最小、成本相加）。查詢與詞條都以「格」表示，所有切法一起比；
 * 前後文單位：查詢在 i 開頭是單位的來源、詞條在 j 開頭是它的目標時，整段一起換；
 * 另外容許「打錯」：刪除查詢的一個字元或插入一個字元，各付 typo。
 */
export function createAligner(inventory: Inventory) {
  const { F, maxL, forms } = inventory
  let buf = new Float64Array(256)
  const fill = (q: AlignSide, e: AlignSide, cost: Float64Array, typo: number, bound: number, context: ContextUnit[][] | null) => {
    const xs = q.lattice, ys = e.lattice
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
        if (context)
          for (const u of context[i]) {
            if (!targetAt(u, e.chars, j)) continue
            const v = d0 + u.cost, to = (i + u.s.length) * W + j + u.t.length
            if (v < D[to]) D[to] = v
          }
        if (typo) {
          if (i < n && d0 + typo < D[(i + 1) * W + j]) D[(i + 1) * W + j] = d0 + typo
          if (j < m && d0 + typo < D[i * W + j + 1]) D[i * W + j + 1] = d0 + typo
        }
      }
    return { D, n, m, W }
  }
  /**
   * 距離；超過 bound 的格不再往下算（結果大於 bound 時可能不精確，但一定大於 bound）。
   * @param context 查詢的 contextMatches（這一對方言的前後文單位）；null 表示沒有
   */
  const distance = (q: AlignSide, e: AlignSide, cost: Float64Array, typo: number, bound = Infinity, context: ContextUnit[][] | null = null): number => {
    const { D, n, W, m } = fill(q, e, cost, typo, bound, context)
    return D[n * W + m]
  }
  /** 最好的對齊（由終點回溯）；查詢與詞條是原本的字串，用來取出每一步的子字串 */
  const align = (query: string, entry: string, cost: Float64Array, typo: number, table: ContextTable | null = null): CsrStep[] => {
    const q: AlignSide = { lattice: inventory.tokenize(query), chars: Array.from(query) }
    const e: AlignSide = { lattice: inventory.tokenize(entry), chars: Array.from(entry) }
    const context = table && table.size ? contextMatches(q.chars, table) : null
    const { D, n, m, W } = fill(q, e, cost, typo, Infinity, context)
    const xs = q.lattice, ys = e.lattice
    const steps: CsrStep[] = []
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
    for (let i = n, j = m; i > 0 || j > 0; ) {
      const here = D[i * W + j]
      let moved = false
      if (typo && i > 0 && near(D[(i - 1) * W + j] + typo, here)) {
        steps.push({ source: q.chars[i - 1], target: '', cost: typo, kind: 'edit' })
        i--
        continue
      }
      if (typo && j > 0 && near(D[i * W + j - 1] + typo, here)) {
        steps.push({ source: '', target: e.chars[j - 1], cost: typo, kind: 'edit' })
        j--
        continue
      }
      // 前後文單位：來源在 i0 開頭、在 i 結束
      if (context)
        for (let i0 = i; i0 >= 0 && !moved; i0--)
          for (const u of context[i0]) {
            if (i0 + u.s.length !== i) continue
            const j0 = j - u.t.length
            if (j0 < 0 || !targetAt(u, e.chars, j0) || !near(D[i0 * W + j0] + u.cost, here)) continue
            steps.push({ source: u.source, target: u.target, cost: u.cost, kind: 'context', ...(u.position ? { position: u.position } : {}) })
            i = i0
            j = j0
            moved = true
            break
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
