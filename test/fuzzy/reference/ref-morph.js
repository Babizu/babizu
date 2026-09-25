/**
 * @file BCDP 分段模型的窮舉參考實作（測試用的仲裁者）。
 *
 * 完全依照 docs/bcdp.md 第 1 節的定義，直接列舉所有「分析」：
 *   前綴鏈 · （非串接步驟） · 詞幹 · 後綴鏈
 * 每一段的距離都以獨立的 refDistance（./ref-distance.js）計算，並套用該段的位置語意（bcdp.md 1.3）：
 * - 詞綴段：左緣算詞首；右緣只在真正的詞尾或空白前算詞尾；詞綴本身（標準形式）是完整的詞
 * - 詞幹段：兩端都算詞首、詞尾（當作一個完整的詞）
 * 不用詞綴圖表、不用詞圖、不剪枝、不用還原變體的上限，所以與正式實作沒有共同的演算法。
 *
 * 語意依 bcdp.md 1.7 的決定（包括「詞綴不跨越空白」）。正式實作尚未符合的地方，
 * 測試以 it.fails 標示（bcdp.md 1.6），修正後翻轉。
 *
 * 只適合小輸入：成本是指數級的。
 */

import { refDistance } from './ref-distance.js'

const EPS = 1e-9
const round = (/** @type {number} */ x) => Math.round(x * 1e9) / 1e9

/**
 * @param {ReturnType<typeof import('./ref-distance.js').refContext>} ctx
 * @param {object} input
 * @param {string} input.query 已正規化的查詢
 * @param {string[]} input.lexicon 可作為詞根的詞
 * @param {any} input.spec createAnalyzer(...).spec（已正規化、已補預設值）
 * @param {number} input.maxDistance 總成本上限 B
 * @param {(pattern: string, base: string) => string | null} input.reduplicant 重疊部分（analyzer.reduplicant）
 * @param {Map<string, string>} [input.why] 除錯用：傳入時，記下每個詞根最佳分析的文字描述
 * @returns {Map<string, number>} 詞根 → W_D（沒有 lemmaSpread 截斷）
 */
export function refMorph(ctx, { query, lexicon, spec, maxDistance, reduplicant, why }) {
  const q = Array.from(query)
  const n = q.length
  const isB = (/** @type {string | undefined} */ ch) => ch !== undefined && ctx.boundaries.has(ch)
  const vowels = new Set(Array.from(spec.vowels))
  const slots = spec.maxSteps
  const minStemSurface = Math.max(1, spec.minStem - 1)
  const delta = spec.affixDistance
  const lambda = spec.lemmaDistance

  /** 首輔音（群）：第一個元音之前的字元 @param {string[]} w */
  const onset = (w) => {
    let k = 0
    while (k < w.length && !vowels.has(w[k])) k++
    return w.slice(0, k)
  }
  const same = (/** @type {string[]} */ a, /** @type {string[]} */ b) => a.length === b.length && a.every((c, k) => c === b[k])

  /**
   * 詞綴段 v[a..b) 對應詞綴 affix 的成本（c ＋ E），超過 δ 或含空白時為 ∞。
   * @param {string[]} v
   * @param {number} a
   * @param {number} b
   * @param {{form: string, cost: number}} affix
   */
  function affixCost(v, a, b, affix) {
    for (let p = a; p < b; p++) if (isB(v[p])) return Infinity // 詞綴不跨越空白（bcdp.md 1.7）
    const d = refDistance(ctx, v, Array.from(affix.form), {
      lo: a,
      hi: b,
      xInitial: (p) => p === a || isB(v[p - 1]),
      xFinal: (p) => p === v.length || isB(v[p]),
    })
    return d <= delta + EPS ? affix.cost + d : Infinity
  }

  /**
   * 前綴鏈：v[0..i) 切成至多 slots 個前綴的最小成本，i 最多到 |v| − minStemSurface。
   * @param {string[]} v
   * @returns {Float64Array} P[i]
   */
  function prefixChart(v) {
    const P = new Float64Array(v.length + 1).fill(Infinity)
    const limit = v.length - minStemSurface
    const rec = (/** @type {number} */ pos, /** @type {number} */ used, /** @type {number} */ cost) => {
      if (cost < P[pos]) P[pos] = cost
      if (used === slots) return
      for (let b = pos + 1; b <= limit; b++) {
        for (const p of spec.prefixes) {
          const c = affixCost(v, pos, b, p)
          if (c < Infinity) rec(b, used + 1, cost + c)
        }
      }
    }
    rec(0, 0, 0)
    return P
  }

  /**
   * 後綴鏈：v[k..|v|) 切成至多 slots 個後綴的最小成本；first 限定第一個後綴（詞幹交替的 before）。
   * @param {string[]} v
   * @param {number} k
   * @param {number} maxCount
   * @param {((form: string) => boolean) | null} first
   */
  function suffixChain(v, k, maxCount, first = null) {
    if (k === v.length) return first ? Infinity : 0
    if (k < minStemSurface || maxCount === 0) return Infinity
    let best = Infinity
    for (let b = k + 1; b <= v.length; b++) {
      for (const s of spec.suffixes) {
        if (first && !first(s.form)) continue
        const c = affixCost(v, k, b, s)
        if (c === Infinity) continue
        best = Math.min(best, c + suffixChain(v, b, maxCount - 1, null))
      }
    }
    return best
  }

  /** 詞幹段 v[i..k) 對 t 的距離（整段當作一個詞） @param {string[]} v @param {number} i @param {number} k @param {string[]} t */
  const stemDistance = (v, i, k, t) => refDistance(ctx, v, t, { lo: i, hi: k })

  /** @type {Map<string, number>} */
  const best = new Map()
  const consider = (/** @type {string} */ term, /** @type {number} */ total, /** @type {() => string} */ describe) => {
    if (total > maxDistance + EPS) return
    const r = round(total)
    if (!(best.get(term) <= r)) {
      best.set(term, r)
      why?.set(term, describe())
    }
  }
  const terms = lexicon.filter((t) => t !== query && Array.from(t).length >= spec.minStem).map((t) => [t, Array.from(t)])

  const P = prefixChart(q)
  /** S[k]：原查詢上由 k 開始的後綴鏈（至多 slots 個） */
  const S = Array.from({ length: n + 1 }, (_, k) => suffixChain(q, k, slots))
  // 詞素交界不能在空白旁（bcdp.md 1.7）：接前綴的詞幹不以空白開頭、接後綴的詞幹不以空白結尾
  for (let i = 1; i < n; i++) if (isB(q[i])) P[i] = Infinity
  for (let k = 1; k < n; k++) if (isB(q[k - 1])) S[k] = Infinity

  // ── 沒有非串接步驟：詞幹是 q[i..k) ──
  for (let i = 0; i <= n; i++) {
    if (P[i] === Infinity) continue
    for (let k = i + 1; k <= n; k++) {
      if (S[k] === Infinity || (i === 0 && k === n)) continue
      for (const [term, t] of terms) {
        const d = stemDistance(q, i, k, t)
        if (d <= lambda + EPS) consider(term, P[i] + d + S[k], () => `P[${i}]=${P[i]} 詞幹 ${q.slice(i, k).join('')}→${term} ${d} S[${k}]=${S[k]}`)
      }
    }
  }

  // ── 中綴與重疊：在前綴鏈的終點 i，拿掉一段之後，詞幹必須越過拿掉的位置 ──
  for (let i = 0; i < n; i++) {
    if (P[i] === Infinity) continue
    const rest = q.slice(i)
    /** @type {Array<{at: number, len: number, cost: number}>} 拿掉 q[at..at+len) */
    const removals = []
    const head = onset(rest)
    if (!head.some(isB) && head.length < rest.length) {
      for (const x of spec.infixes) {
        const xs = Array.from(x.form)
        const at = i + head.length
        if (!same(q.slice(at, at + xs.length), xs)) continue
        const reduced = [...q.slice(0, at), ...q.slice(at + xs.length)]
        if (reduced.length - i < spec.minStem) continue
        if (!same(onset(reduced.slice(i)), head)) continue
        removals.push({ at, len: xs.length, cost: x.cost })
      }
    }
    for (const r of spec.reduplication) {
      for (let len = 1; i + len < n; len++) {
        const red = q.slice(i, i + len)
        const base = q.slice(i + len)
        if (base.length < spec.minStem) break
        if (red.some(isB)) break // 重疊部分不跨越空白
        if (reduplicant(r.pattern, base.join('')) !== red.join('')) continue
        removals.push({ at: i, len, cost: r.cost })
      }
    }
    for (const { at, len, cost } of removals) {
      const v = [...q.slice(0, at), ...q.slice(at + len)]
      for (let k = at + 1; k <= v.length; k++) {
        // 詞幹終點 k（在 v 上）對應原查詢的位置 k + len
        const tail = S[k + len]
        if (tail === Infinity) continue
        for (const [term, t] of terms) {
          const d = stemDistance(v, i, k, t)
          if (d <= lambda + EPS) consider(term, P[i] + cost + d + tail, () => `P[${i}]=${P[i]} 拿掉 q[${at}..${at + len}) ${cost} 詞幹 ${v.slice(i, k).join('')}→${term} ${d} 尾 ${tail}`)
        }
      }
    }
  }

  // ── 詞幹交替：詞幹表面形式的結尾 surface 還原成 underlying；後面第一個後綴要在 before 中 ──
  for (const a of spec.alternations) {
    const surface = Array.from(a.surface)
    const underlying = Array.from(a.underlying)
    for (let l = spec.minStem; l < n; l++) {
      if (!same(q.slice(l - surface.length, l), surface)) continue
      const first = a.before ? (/** @type {string} */ form) => a.before.includes(form) : () => true
      const tail = suffixChain(q, l, slots + 1, first)
      if (tail === Infinity) continue
      const cut = l - surface.length
      const v = [...q.slice(0, cut), ...underlying, ...q.slice(l)]
      const k = cut + underlying.length
      for (let i = 0; i <= cut; i++) {
        if (P[i] === Infinity) continue
        for (const [term, t] of terms) {
          const d = stemDistance(v, i, k, t)
          if (d <= lambda + EPS) consider(term, P[i] + d + a.cost + tail, () => `P[${i}]=${P[i]} 交替 ${a.underlying}>${a.surface} 詞幹 ${v.slice(i, k).join('')}→${term} ${d} 尾 ${tail}`)
        }
      }
    }
  }
  return best
}
