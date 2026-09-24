/**
 * @file 構詞搜尋：音變 ∘ 構詞 ∘ 詞庫的聯合模糊搜尋（以邊界條件耦合的詞圖 DP）。
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
 * 正確性（定理 1、2）與上界性質見 docs/fuzzy-search.md 第 10 節；性質測試見 test/fuzzy/boundary.test.js。
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

/** 還原變體（含原查詢）的上限：多通道搜尋最多 31 個通道，另一個留給普通模糊搜尋 */
const MAX_VARIANTS = 16

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
    // 查詢從 k 到詞尾的整段：詞尾規則只在真正的詞尾適用（詞綴 trie 很淺，多出來的欄位不影響剪枝）
    const piece = chars.slice(k).join('')
    const key = `${tag}${piece}`
    const cached = scanCache.get(key)
    if (cached) return cached.map((e) => ({ ...e, from: e.from + k, to: e.to + k }))
    /** @type {ChartEdge[]} */
    const edges = []
    if (piece) {
      idx.search(piece, {
        maxDistance: spec.affixDistance,
        onTerminal: (_term, row, payloads) => {
          for (let l = 1; l < row.length; l++) {
            if (row[l] > spec.affixDistance + EPSILON) continue
            for (const affix of /** @type {AffixEntry[]} */ (payloads)) {
              edges.push({ from: 0, to: l, affix, distance: roundCost(row[l]) })
            }
          }
        },
      })
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
    return { P: best(P), S: best(S), backP, backS, suffixEdges }
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
    /** @type {Array<{chars: string[], start: Float64Array, end: Float64Array, map: (i: number) => number, op: MorphStepHit | null, at: number}>} */
    const out = [{ chars, start: P, end: S, map: (i) => i, op: null, at: -1 }]

    for (let k = 0; k < n; k++) {
      if (P[k] === Infinity) continue
      const rest = chars.slice(k).join('')
      const head = analyzer.onset(rest)
      const headLength = Array.from(head).length

      // 中綴：詞幹首輔音之後、首元音之前
      for (const x of spec.infixes) {
        const xs = Array.from(x.form)
        const at = k + headLength
        if (chars.slice(at, at + xs.length).join('') !== x.form) continue
        const reduced = [...chars.slice(0, at), ...chars.slice(at + xs.length)]
        if (reduced.length - k < spec.minStem) continue
        if (analyzer.onset(reduced.slice(k).join('')) !== head) continue
        out.push(
          shifted(chars, reduced, P, S, k, at, xs.length, x.cost, {
            type: 'infix',
            form: x.form,
            gloss: x.gloss,
            cost: x.cost,
          }),
        )
      }

      // 重疊：詞幹前面的重疊部分
      for (const r of spec.reduplication) {
        for (let len = 1; len <= 4 && k + len < n; len++) {
          const red = chars.slice(k, k + len).join('')
          const base = chars.slice(k + len)
          if (base.length < spec.minStem) break
          if (analyzer.reduplicant(r.pattern, base.join('')) !== red) continue
          const reduced = [...chars.slice(0, k), ...base]
          out.push(
            shifted(chars, reduced, P, S, k, k, len, r.cost, {
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
        if (S[l] === Infinity) continue
        if (chars.slice(l - surface.length, l).join('') !== a.surface) continue
        // 緊接的第一個後綴必須在 before 清單中
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
        })
      }
    }
    return out
  }

  /**
   * 在位置 at 拿掉 len 個字元（中綴或重疊）後的變體：詞幹只能從 k 開始，邊界向量跟著位移。
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
    /** @type {MorphStepHit} */ op,
  ) {
    const m = reduced.length
    const start = new Float64Array(m + 1).fill(Infinity)
    start[k] = roundCost(P[k] + cost)
    const end = new Float64Array(m + 1).fill(Infinity)
    for (let i = 0; i <= chars.length; i++) {
      if (i > at && i < at + len) continue
      const j = i <= at ? i : i - len
      // 詞幹必須越過中綴（或重疊）所在的位置
      if (j > at) end[j] = S[i]
    }
    return { chars: reduced, start, end, map: (j) => (j <= at ? j : j + len), op, at: k }
  }

  /**
   * @typedef {object} Prepared 構詞搜尋的準備結果
   * @property {string} query
   * @property {string[]} chars
   * @property {ReturnType<typeof charts>} charts
   * @property {Array<ReturnType<typeof variants>[number] & {text: string, starts: number[], ends: number[]}>} variants
   * @property {Array<{query: string, options: import('./fuzzy-index.js').SearchOptions}>} channels 每個變體一個搜尋通道
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
    for (const v of variants(chars, c)) {
      const starts = []
      const ends = []
      for (let i = 0; i <= v.chars.length; i++) {
        if (v.start[i] < Infinity) starts.push(i)
        if (v.end[i] < Infinity) ends.push(i)
      }
      if (starts.length === 0 || ends.length === 0) continue
      list.push({ ...v, text: v.chars.join(''), starts, ends })
      if (list.length >= MAX_VARIANTS) break
    }
    return {
      query,
      chars,
      charts: c,
      variants: list,
      channels: list.map((v) => ({
        query: v.text,
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
    prepared.variants.forEach((v, vi) => {
      const m = v.chars.length
      const text = v.text
      /** @type {Map<string, number>} 子字串對詞的距離只算一次 */
      const memo = new Map()
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
            const key = `${i}:${k}:${term}`
            let d = memo.get(key)
            if (d === undefined) memo.set(key, (d = metric.distance(text.slice(i, k), term)))
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
          ...(v.op?.type === 'alternation' ? alternationSuffix(c, chars, v.at) : suffixSteps(c, chars, v.map(bestK))),
        ]
        if (steps.length === 0) continue
        const hit = {
          term,
          payloads: r.payloads,
          distance: roundCost(bestTotal),
          stemSurface: text.slice(bestI, bestK),
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
   * @param {ReturnType<typeof charts>} c
   * @param {string[]} chars
   * @param {number} l 後綴鏈的起點
   */
  function alternationSuffix(c, chars, l) {
    /** @type {ChartEdge | null} */
    let first = null
    let firstCost = Infinity
    for (const e of c.suffixEdges[l] ?? []) {
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
