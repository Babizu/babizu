/**
 * @file 構詞搜尋：音變 ∘ 構詞 ∘ 詞庫的聯合模糊搜尋——BCDP（Boundary-Coupled DP，邊界耦合 DP）。
 *
 * 問題：查詢 q 是某個詞庫詞 t 的衍生形，而且可能帶著方言音變（詞幹或詞綴裡都可能有）。要求
 *
 *   W(q, t) = min over 0 ≤ i ≤ k ≤ n of  P[i] + E(q[i..k), t) + S[k]
 *
 * - P[i]：把 q[0..i) 解析成前綴鏈的最小成本（每個前綴允許 affixDistance 以內的音變）
 * - S[k]：把 q[k..n) 解析成後綴鏈的最小成本
 * - E：同一套加權編輯距離（方言規則）
 *
 * 做法（受 pika parser「以位置為索引的 memo 表、依相依方向填表」的啟發）：
 * 1. 先填好兩張「位置 → 成本」的圖表 P、S。每個起點各在前綴／後綴 trie 上跑一次小型 DP，
 *    從整列讀出「q[k..k+l) 對每個詞綴的距離」。
 * 2. 以 P 為 DP 的起始列、S 為詞尾的附加成本，對詞庫詞圖做**一次**走訪（FuzzyIndex 的邊界條件）。
 *    遞推式、方言規則、剪枝都與普通模糊搜尋相同；普通搜尋是 P = [0, ∞…]、S = [∞…, 0] 的特例。
 * 3. 中綴、重疊、詞幹交替不是「加在外面」的，先在查詢上產生少數還原變體（在前綴鏈的終點拿掉中綴…），
 *    每個變體各跑一次步驟 2。
 *
 * 模型的正式定義、正確性（定理 1–3）與它和 FST 聯合最佳解 W* 的關係見 docs/bcdp.md；
 * 性質測試見 test/fuzzy/boundary.test.js、test/fuzzy/morph-search.test.js。
 */

import { EPSILON, roundCost } from './dp.js'
import { FuzzyIndex } from './fuzzy-index.js'

/**
 * @typedef {object} AffixEntry 詞綴清單中的一項（已正規化）
 * @property {string} form
 * @property {import('./morphology.js').Gloss} gloss
 * @property {number} cost
 */

/**
 * @typedef {object} ChartEdge 圖表中的一條邊：q[from..to) 對應到某個詞綴
 * @property {number} from
 * @property {number} to
 * @property {AffixEntry} affix
 * @property {number} distance 表面形式與詞綴的加權編輯距離（≤ affixDistance）
 */

/**
 * @typedef {object} MorphStepHit 命中說明中的一個構詞步驟
 * @property {'prefix' | 'suffix' | 'infix' | 'reduplication' | 'alternation'} type
 * @property {string} form 標準形式（詞綴清單中的寫法）
 * @property {string} [surface] 查詢中的實際寫法（與 form 不同表示詞綴本身有音變）
 * @property {string} [pattern] 重疊模式
 * @property {import('./morphology.js').Gloss} gloss
 * @property {number} cost 這一步的成本（詞綴成本＋詞綴音變距離）
 */

/**
 * @typedef {object} MorphHit
 * @property {string} term 命中的詞庫詞（詞幹）
 * @property {unknown[]} payloads
 * @property {number} distance 總成本：構詞步驟＋詞綴音變＋詞幹音變
 * @property {string} stemSurface 查詢中對應詞幹的那一段
 * @property {number} stemDistance 詞幹部分的加權編輯距離
 * @property {MorphStepHit[]} steps 由外而內
 */

/** 詞綴圖表的快取上限（同一個網頁工作階段中重複查詢時省下重算） */
const CACHE_LIMIT = 2000

/**
 * 還原變體（含原查詢）的上限。多通道走訪沒有通道數的限制，這只是防止病態輸入（很長的查詢、
 * 很多交替規則）讓一次查詢展開成上百個通道；超過時 prepare 的結果標記 truncated。
 * 變體的產生順序固定（原查詢、各前綴鏈終點的中綴與重疊、詞幹交替），截斷時保留前面的。
 */
const MAX_VARIANTS = 64

/**
 * 建立構詞搜尋器。
 * @param {object} deps
 * @param {import('./morphology.js').Analyzer} deps.analyzer 構詞規格（已正規化）
 * @param {import('./distance.js').WeightedEditDistance} deps.metric 與詞庫相同的距離函式
 * @param {FuzzyIndex} deps.index 詞庫
 */
export function createMorphSearch({ analyzer, metric, index }) {
  const spec = analyzer.spec
  const affixIndex = (/** @type {AffixEntry[]} */ list) => {
    const idx = new FuzzyIndex(metric)
    for (const a of list) idx.add(a.form, a)
    return idx
  }
  const prefixIndex = affixIndex(spec.prefixes)
  /** 詞邊界字元（預設為空白）：詞綴、中綴、重疊部分都不能包含或跨越它（docs/bcdp.md 1.7） */
  const isBoundary = (/** @type {string | undefined} */ ch) => ch !== undefined && metric.boundaries.has(ch)
  /**
   * 詞幹部分在 λ 以內最多能改變幾個字元的長度：一般的增刪每字元至少 min(插入, 刪除) 成本；
   * 個別字元的覆寫與方言規則（例如 au→o）可能更便宜，所以以「λ ÷ 最便宜的每字元代價」估計上限。
   */
  const maxLengthChange = (() => {
    const { costs, compiled } = metric
    let perChar = Math.min(costs.insertCost, costs.deleteCost)
    // 個別字元的覆寫（例如空白的增刪只要 0.1）也算進去
    for (const o of costs.overrides.values()) perChar = Math.min(perChar, o.insert ?? Infinity, o.delete ?? Infinity)
    for (const rule of compiled.rules) {
      const diff = Math.abs(rule.sourceLength - rule.targetLength)
      if (diff > 0) perChar = Math.min(perChar, rule.weight / diff)
    }
    return perChar > 0 ? Math.ceil(spec.lemmaDistance / perChar + 1e-9) : Infinity
  })()
  const suffixIndex = affixIndex(spec.suffixes)
  /** @type {Map<string, ChartEdge[]>} */
  const scanCache = new Map()

  /**
   * 從位置 k 開始，q[k..k+l) 在 affixDistance 以內對應到哪些詞綴。
   * 在詞綴 trie 上跑一次 DP，詞尾回呼給出整列：row[l] = E(q[k..k+l), 詞綴)。
   * @param {FuzzyIndex} idx
   * @param {string[]} chars
   * @param {number} k
   * @param {'p' | 's'} tag 快取鍵的前綴
   * @returns {ChartEdge[]}
   */
  function scan(idx, chars, k, tag) {
    // 查詢從 k 到詞尾的整段（已正規化的 code point 陣列，原樣使用、不再正規化）：
    // 詞尾規則只在真正的詞尾或空白前適用（詞綴 trie 很淺，多出來的欄位不影響剪枝）。
    const piece = chars.slice(k)
    // 詞綴不跨越空白（docs/bcdp.md 1.7）：只收 q[k..k+l) 不含邊界字元的 l
    let limit = piece.length
    for (let l = 0; l < piece.length; l++) {
      if (isBoundary(piece[l])) {
        limit = l
        break
      }
    }
    const key = `${tag}${piece.join('')}`
    const cached = scanCache.get(key)
    if (cached) return cached.map((e) => ({ ...e, from: e.from + k, to: e.to + k }))
    /** @type {ChartEdge[]} */
    const edges = []
    if (limit > 0) {
      const onTerminal = (/** @type {string} */ _term, /** @type {Float64Array} */ row, /** @type {unknown[]} */ payloads) => {
        for (let l = 1; l <= limit; l++) {
          if (row[l] > spec.affixDistance + EPSILON) continue
          for (const affix of /** @type {AffixEntry[]} */ (payloads)) {
            edges.push({ from: 0, to: l, affix, distance: roundCost(row[l]) })
          }
        }
      }
      idx.searchChannels([{ query: piece, options: { maxDistance: spec.affixDistance, onTerminal } }])
    }
    if (scanCache.size > CACHE_LIMIT) scanCache.clear()
    scanCache.set(key, edges)
    return edges.map((e) => ({ ...e, from: e.from + k, to: e.to + k }))
  }

  /**
   * 前綴鏈與後綴鏈的圖表（Viterbi）。
   * P[i] = min 前綴鏈成本，q[0..i) 被切成至多 maxSteps 個詞綴；S[k] 對稱。
   * 依相依方向填表：P 由左而右、S 由右而左，每一格只依賴已經填好的格子。
   * @param {string[]} chars
   */
  function charts(chars) {
    const n = chars.length
    const slots = spec.maxSteps
    const minStemSurface = Math.max(1, spec.minStem - 1)
    /** P[s][i]：恰好 s 個前綴 */
    const P = Array.from({ length: slots + 1 }, () => new Float64Array(n + 1).fill(Infinity))
    /** @type {Array<Array<ChartEdge | null>>} 回溯：P[s][i] 的最後一條邊 */
    const backP = Array.from({ length: slots + 1 }, () => new Array(n + 1).fill(null))
    P[0][0] = 0
    /** @type {ChartEdge[][]} */
    const prefixEdges = []
    for (let s = 0; s < slots; s++) {
      for (let k = 0; k <= n - minStemSurface; k++) {
        if (P[s][k] === Infinity) continue
        prefixEdges[k] ??= scan(prefixIndex, chars, k, 'p')
        for (const e of prefixEdges[k]) {
          if (e.to > n - minStemSurface) continue
          const c = P[s][k] + e.affix.cost + e.distance
          if (c < P[s + 1][e.to] - EPSILON) {
            P[s + 1][e.to] = roundCost(c)
            backP[s + 1][e.to] = e
          }
        }
      }
    }

    /** S[s][k]：恰好 s 個後綴 */
    const S = Array.from({ length: slots + 1 }, () => new Float64Array(n + 1).fill(Infinity))
    const backS = Array.from({ length: slots + 1 }, () => new Array(n + 1).fill(null))
    S[0][n] = 0
    /** @type {ChartEdge[][]} 由起點 k 出發的後綴邊 */
    const suffixEdges = []
    for (let k = minStemSurface; k < n; k++) suffixEdges[k] = scan(suffixIndex, chars, k, 's')
    for (let s = 0; s < slots; s++) {
      for (let k = n - 1; k >= minStemSurface; k--) {
        for (const e of suffixEdges[k]) {
          if (S[s][e.to] === Infinity) continue
          const c = S[s][e.to] + e.affix.cost + e.distance
          if (c < S[s + 1][k] - EPSILON) {
            S[s + 1][k] = roundCost(c)
            backS[s + 1][k] = e
          }
        }
      }
    }

    // 各位置取最好的槽位數
    const best = (/** @type {Float64Array[]} */ table) => {
      const out = new Float64Array(n + 1).fill(Infinity)
      const slotAt = new Int8Array(n + 1)
      for (let s = 0; s <= slots; s++) {
        for (let i = 0; i <= n; i++) {
          if (table[s][i] < out[i]) {
            out[i] = table[s][i]
            slotAt[i] = s
          }
        }
      }
      return { cost: out, slotAt }
    }
    const bestP = best(P)
    const bestS = best(S)
    // 詞素交界不能在空白旁（docs/bcdp.md 1.7）：接前綴的詞幹不能以空白開頭，接後綴的詞幹不能以空白結尾。
    // 詞綴本身已不含空白，所以只要遮掉「下一個字元是空白」的前綴鏈終點、「前一個字元是空白」的後綴鏈起點。
    // 片語中每個詞的構詞，交給搜尋引擎的逐詞搜尋。
    for (let i = 1; i < n; i++) if (isBoundary(chars[i])) bestP.cost[i] = Infinity
    for (let k = 1; k < n; k++) if (isBoundary(chars[k - 1])) bestS.cost[k] = Infinity
    return { P: bestP, S: bestS, backP, backS, suffixEdges }
  }

  /**
   * 回溯前綴鏈：P 在位置 i 的最佳切法，由左而右（＝由外而內）。
   * @param {ReturnType<typeof charts>} c
   * @param {string[]} chars
   * @param {number} i
   * @returns {MorphStepHit[]}
   */
  function prefixSteps(c, chars, i) {
    /** @type {MorphStepHit[]} */
    const out = []
    let s = c.P.slotAt[i]
    let pos = i
    while (s > 0) {
      const e = /** @type {ChartEdge} */ (c.backP[s][pos])
      out.unshift(affixStep('prefix', e, chars))
      pos = e.from
      s--
    }
    return out
  }

  /**
   * 回溯後綴鏈：S 在位置 k 的最佳切法，由右而左（＝由外而內）。
   * @param {ReturnType<typeof charts>} c
   * @param {string[]} chars
   * @param {number} k
   * @returns {MorphStepHit[]}
   */
  function suffixSteps(c, chars, k) {
    /** @type {MorphStepHit[]} */
    const inner = []
    let s = c.S.slotAt[k]
    let pos = k
    while (s > 0) {
      const e = /** @type {ChartEdge} */ (c.backS[s][pos])
      inner.push(affixStep('suffix', e, chars))
      pos = e.to
      s--
    }
    return inner.reverse()
  }

  /**
   * 查詢的還原變體：原查詢，加上在前綴鏈終點拿掉中綴／重疊、在後綴鏈起點還原詞幹交替的版本。
   * 每個變體帶著自己的邊界向量；非串接的步驟只允許發生在詞幹的邊緣（中綴、重疊在詞幹開頭，交替在詞幹結尾）。
   * @param {string[]} chars
   * @param {ReturnType<typeof charts>} c
   */
  function variants(chars, c) {
    const n = chars.length
    const P = c.P.cost
    const S = c.S.cost
    /** @type {Array<{chars: string[], start: Float64Array, end: Float64Array, map: (i: number) => number, op: MorphStepHit | null, at: number, before?: string[] | null}>} */
    const out = [{ chars, start: P, end: S, map: (i) => i, op: null, at: -1 }]

    for (let k = 0; k < n; k++) {
      if (P[k] === Infinity) continue
      const rest = chars.slice(k).join('')
      const head = analyzer.onset(rest)
      const headLength = Array.from(head).length

      // 中綴：詞幹首輔音之後、首元音之前（首輔音不能含空白：構詞不跨越詞邊界）
      for (const x of Array.from(head).some(isBoundary) ? [] : spec.infixes) {
        const xs = Array.from(x.form)
        const at = k + headLength
        if (chars.slice(at, at + xs.length).join('') !== x.form) continue
        const reduced = [...chars.slice(0, at), ...chars.slice(at + xs.length)]
        if (reduced.length - k < spec.minStem) continue
        if (analyzer.onset(reduced.slice(k).join('')) !== head) continue
        out.push(
          shifted(chars, reduced, P, S, k, at, xs.length, x.cost, null, {
            type: 'infix',
            form: x.form,
            gloss: x.gloss,
            cost: x.cost,
          }),
        )
      }

      // 重疊：詞幹前面的重疊部分。試每一種長度（沒有上限）。模板只套用在詞幹上（不含後綴），
      // 而且詞幹取自查詢，所以複製的是查詢（方言）的形式；詞幹的長度只能是模板正好產生 red 的那些
      // （reduplicantStems；full 時就是 red 本身的長度）
      for (const r of spec.reduplication) {
        for (let len = 1; k + len < n; len++) {
          const red = chars.slice(k, k + len).join('')
          const base = chars.slice(k + len)
          if (base.length < spec.minStem) break
          if (isBoundary(chars[k + len - 1])) break // 重疊部分不跨越空白
          const lengths = analyzer.reduplicantStems(r.pattern, base, red)
          if (!lengths.length) continue
          const reduced = [...chars.slice(0, k), ...base]
          out.push(
            shifted(chars, reduced, P, S, k, k, len, r.cost, lengths, {
              type: 'reduplication',
              form: red,
              pattern: r.pattern,
              gloss: r.gloss,
              cost: r.cost,
            }),
          )
        }
      }
    }

    // 詞幹交替：詞幹最後的 surface 在（指定的）後綴前還原成 underlying
    for (const a of spec.alternations) {
      const surface = Array.from(a.surface)
      for (let l = spec.minStem; l < n; l++) {
        if (chars.slice(l - surface.length, l).join('') !== a.surface) continue
        // 緊接的第一個後綴必須在 before 清單中；其後至多再 maxSteps 個後綴（S[e.to]）。
        // 不要求 S[l] 有限：交替後面的後綴鏈可以有 maxSteps ＋ 1 個（docs/bcdp.md 1.2 限制 3）
        let endCost = Infinity
        for (const e of c.suffixEdges[l] ?? []) {
          if (a.before && !a.before.includes(e.affix.form)) continue
          const tail = e.to === n ? 0 : S[e.to]
          endCost = Math.min(endCost, e.affix.cost + e.distance + tail)
        }
        if (endCost === Infinity) continue
        const underlying = Array.from(a.underlying)
        const cut = l - surface.length
        const reduced = [...chars.slice(0, cut), ...underlying, ...chars.slice(l)]
        const m = reduced.length
        const start = new Float64Array(m + 1).fill(Infinity)
        for (let i = 0; i <= cut; i++) start[i] = P[i]
        const end = new Float64Array(m + 1).fill(Infinity)
        end[cut + underlying.length] = roundCost(endCost + a.cost)
        out.push({
          chars: reduced,
          start,
          end,
          map: (i) => (i <= cut ? i : i - underlying.length + surface.length),
          op: { type: 'alternation', form: `${a.underlying}>${a.surface}`, gloss: null, cost: a.cost },
          at: l,
          // 說明時挑第一個後綴也要遵守同一個限制（alternationSuffix）
          before: a.before,
        })
      }
    }
    return out
  }

  /**
   * 在位置 at 拿掉 len 個字元（中綴或重疊）後的變體：詞幹只能從 k 開始，邊界向量跟著位移。
   * stemLengths 不為 null 時（重疊），詞幹的長度只能是其中之一（遞增；以 at 起算）。
   * @returns {{chars: string[], start: Float64Array, end: Float64Array, map: (i: number) => number, op: MorphStepHit, at: number}}
   */
  function shifted(
    /** @type {string[]} */ chars,
    /** @type {string[]} */ reduced,
    /** @type {Float64Array} */ P,
    /** @type {Float64Array} */ S,
    /** @type {number} */ k,
    /** @type {number} */ at,
    /** @type {number} */ len,
    /** @type {number} */ cost,
    /** @type {number[] | null} */ stemLengths,
    /** @type {MorphStepHit} */ op,
  ) {
    const m = reduced.length
    const start = new Float64Array(m + 1).fill(Infinity)
    start[k] = roundCost(P[k] + cost)
    const end = new Float64Array(m + 1).fill(Infinity)
    if (stemLengths) {
      // 重疊：詞幹 reduced[at..at+L)，對應原查詢的終點 at + L + len
      for (const l of stemLengths) end[at + l] = S[at + l + len]
    } else {
      for (let i = 0; i <= chars.length; i++) {
        if (i > at && i < at + len) continue
        const j = i <= at ? i : i - len
        if (j > at) end[j] = S[i] // 詞幹必須越過中綴所在的位置
      }
    }
    return { chars: reduced, start, end, map: (j) => (j <= at ? j : j + len), op, at: k }
  }

  /**
   * @typedef {object} Prepared 構詞搜尋的準備結果
   * @property {string} query
   * @property {string[]} chars
   * @property {ReturnType<typeof charts>} charts
   * @property {Array<ReturnType<typeof variants>[number] & {text: string, starts: number[], ends: number[]}>} variants
   * @property {Array<{query: string[], options: import('./fuzzy-index.js').SearchOptions}>} channels 每個變體一個搜尋通道
   * @property {boolean} truncated 還原變體超過 MAX_VARIANTS 而被截斷
   */

  /**
   * 構詞搜尋的第一步：算好詞綴圖表與還原變體，產生搜尋通道（交給 FuzzyIndex.searchChannels）。
   *
   * 通道的邊界向量只保留「可以在這裡開始／結束」（有限成本一律當 0），上限是 λ = lemmaDistance。
   * 由定理 1，通道找到的正是「存在某個 (i, k) 使 E(q[i..k), t) ≤ λ」的詞 t。詞幹部分的音變上限
   * 本來就是 λ，所以這是必要條件，一個也不會漏；λ 很小，剪枝幾乎和精確查詢一樣快。
   * 真正的成本（加上詞綴鏈）在 `finish` 中計算。
   *
   * @param {string} query 已正規化的查詢（搜尋鍵）
   * @returns {Prepared | null} 查詢太短時為 null
   */
  function prepare(query) {
    const chars = Array.from(query)
    if (chars.length < spec.minStem + 1) return null
    const c = charts(chars)
    const zero = (/** @type {Float64Array} */ vec) => Float64Array.from(vec, (x) => (x < Infinity ? 0 : Infinity))
    /** @type {Prepared['variants']} */
    const list = []
    let truncated = false
    for (const v of variants(chars, c)) {
      const starts = []
      const ends = []
      for (let i = 0; i <= v.chars.length; i++) {
        if (v.start[i] < Infinity) starts.push(i)
        if (v.end[i] < Infinity) ends.push(i)
      }
      if (starts.length === 0 || ends.length === 0) continue
      if (list.length >= MAX_VARIANTS) {
        truncated = true
        break
      }
      list.push({ ...v, text: v.chars.join(''), starts, ends })
    }
    return {
      query,
      chars,
      charts: c,
      variants: list,
      truncated,
      channels: list.map((v) => ({
        // 已正規化的 code point 陣列：FuzzyIndex 原樣使用，不再正規化
        query: v.chars,
        options: { maxDistance: spec.lemmaDistance, start: zero(v.start), end: zero(v.end) },
      })),
    }
  }

  /**
   * 構詞搜尋的第二步：對每個候選，在有限的 (i, k) 組合上算 P[i] + E(q[i..k), t) + S[k]，
   * 取 E ≤ λ 者的最小值，並回溯出構詞步驟。
   *
   * @param {Prepared} prepared
   * @param {import('./fuzzy-index.js').SearchResult[][]} resultsPerChannel 與 prepared.channels 對應
   * @param {number} maxDistance 總成本上限
   * @returns {MorphHit[]} 依成本排序，只保留「最佳 ＋ lemmaSpread」之內
   */
  function finish(prepared, resultsPerChannel, maxDistance) {
    const { query, chars, charts: c } = prepared
    const lambda = spec.lemmaDistance
    /** @type {Map<string, MorphHit>} */
    const best = new Map()
    /**
     * 詞 → 正規化後的字元（同一個詞可能出現在好幾個變體的結果中，只正規化一次）。
     * @type {Map<string, string[]>}
     */
    const termChars = new Map()
    prepared.variants.forEach((v, vi) => {
      const m = v.chars.length
      /**
       * 查詢片段 v.chars[i..k) 的編譯結果（成本表與規則表），依 i·(m+1)+k 索引。
       * 同一個片段要和很多候選詞比較，編譯一次、共用給所有候選詞。
       * 這取代了最佳化前（commit e1557f4）每一組（片段, 詞）都呼叫 metric.distance 的做法：那會對片段與詞
       * 各做一次完整的正規化（含 Unicode 分解與正規表示式）並重新編譯查詢。
       * @type {Map<number, import('./dp.js').QueryPlan>}
       */
      const plans = new Map()
      for (const r of resultsPerChannel[vi] ?? []) {
        const term = r.term
        const termLength = Array.from(term).length
        if (term === query || termLength < spec.minStem) continue
        let bestTotal = Infinity
        let bestI = -1
        let bestK = -1
        let bestStem = Infinity
        for (const i of v.starts) {
          for (const k of v.ends) {
            if (k <= i) continue
            // 原查詢上「從頭到尾都是詞幹」的路徑是普通模糊命中，不算構詞命中
            if (!v.op && i === 0 && k === m) continue
            // 長度差太多的切法不可能在 λ 以內（每個字元的增刪至少要付 minLengthStepCost）
            if (Math.abs(k - i - termLength) > maxLengthChange) continue
            // 詞幹片段直接以 code point 陣列切出（不再正規化：再正規化會截掉頭尾空白、
            // UTF-16 切片會切壞非 BMP 字元，docs/bcdp.md 1.6）；片段當作一個完整的詞計算距離
            const key = i * (m + 1) + k
            let plan = plans.get(key)
            if (plan === undefined) plans.set(key, (plan = metric.prepareQuery(v.chars.slice(i, k))))
            let y = termChars.get(term)
            if (y === undefined) termChars.set(term, (y = metric.prepare(term)))
            const d = metric.distancePrepared(plan, y)
            if (d > lambda + EPSILON) continue
            const total = v.start[i] + d + v.end[k]
            // 同分時取詞幹較短的切法（詞綴說明較完整）
            if (total < bestTotal - EPSILON || (Math.abs(total - bestTotal) <= EPSILON && k - i < bestK - bestI)) {
              bestTotal = total
              bestI = i
              bestK = k
              bestStem = d
            }
          }
        }
        if (bestI < 0 || bestTotal > maxDistance + EPSILON) continue
        const originalStart = v.op && v.op.type !== 'alternation' ? v.at : bestI
        const steps = [
          ...prefixSteps(c, chars, originalStart),
          ...(v.op ? [v.op] : []),
          ...(v.op?.type === 'alternation' ? alternationSuffix(c, chars, v.at, v.before ?? null) : suffixSteps(c, chars, v.map(bestK))),
        ]
        if (steps.length === 0) continue
        const hit = {
          term,
          payloads: r.payloads,
          distance: roundCost(bestTotal),
          stemSurface: v.chars.slice(bestI, bestK).join(''),
          stemDistance: roundCost(bestStem),
          steps,
        }
        const prev = best.get(term)
        if (!prev || hit.distance < prev.distance - EPSILON) best.set(term, hit)
      }
    })
    const hits = [...best.values()].sort((a, b) => a.distance - b.distance || (a.term < b.term ? -1 : 1))
    if (hits.length === 0) return hits
    const cutoff = hits[0].distance + spec.lemmaSpread + EPSILON
    return hits.filter((h) => h.distance <= cutoff)
  }

  /**
   * 構詞搜尋（單獨執行；搜尋引擎則把通道與普通模糊搜尋合併成一次走訪）。
   * @param {string} query 已正規化的查詢（搜尋鍵）
   * @param {{maxDistance: number, stats?: {visitedNodes: number}}} options
   * @returns {MorphHit[]}
   */
  function search(query, { maxDistance, stats }) {
    const prepared = prepare(query)
    if (!prepared) return []
    const local = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    const results = index.searchChannels(prepared.channels, local)
    if (stats) stats.visitedNodes += local.visitedNodes
    return finish(prepared, results, maxDistance)
  }

  /**
   * 詞幹交替之後的後綴鏈：第一個後綴要在 before 清單中，所以不能直接用 S 的回溯。
   * 挑選的條件與 variants() 計算 endCost 時完全相同，所以說明中各步驟的成本加起來等於命中的成本。
   * @param {ReturnType<typeof charts>} c
   * @param {string[]} chars
   * @param {number} l 後綴鏈的起點
   * @param {string[] | null} before 第一個後綴允許的形式（null 表示不限）
   */
  function alternationSuffix(c, chars, l, before) {
    /** @type {ChartEdge | null} */
    let first = null
    let firstCost = Infinity
    for (const e of c.suffixEdges[l] ?? []) {
      if (before && !before.includes(e.affix.form)) continue
      const tail = e.to === chars.length ? 0 : c.S.cost[e.to]
      const cost = e.affix.cost + e.distance + tail
      if (cost < firstCost) {
        firstCost = cost
        first = e
      }
    }
    if (!first) return []
    return [...(first.to === chars.length ? [] : suffixSteps(c, chars, first.to)), affixStep('suffix', first, chars)]
  }

  return { search, prepare, finish, charts }
}

/**
 * @param {'prefix' | 'suffix'} type
 * @param {ChartEdge} e
 * @param {string[]} chars
 * @returns {MorphStepHit}
 */
function affixStep(type, e, chars) {
  const surface = chars.slice(e.from, e.to).join('')
  return {
    type,
    form: e.affix.form,
    ...(surface !== e.affix.form ? { surface } : {}),
    gloss: e.affix.gloss,
    cost: roundCost(e.affix.cost + e.distance),
  }
}
