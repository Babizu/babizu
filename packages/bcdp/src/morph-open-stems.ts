/**
 * @file 開放詞彙的詞幹（虛擬詞根的候選；docs/bcdp.md 10.5）：由通道兩側的交界列直接讀出，不走訪詞圖。
 */

import { EDGE_WORD, EPSILON } from './dp.ts'
import type { JunctionEnd } from './junction.ts'
import type { MorphContext, Prepared, StemResult } from './morph-types.ts'

/**
 * 開放詞彙的詞幹（不在詞庫中）：**字面的**詞幹，就是通道查詢中原樣的一段 q[i..j)，
 * 只在兩端還原構詞音變；不做其他音變，規則也不跨進詞幹。所以整個詞的對齊在詞幹兩端的交界處斷開，
 * 最小成本直接由交界列讀出，不走訪任何詞圖（定理 A）：
 *
 *   cost(i, j) ＝ F[i] ＋ min(to.row[j], to.word[j])
 *
 * F 是起點那一側的交界列（前綴鏈、環綴的左邊、還原變體的固定起點；沒有時是詞首），to 是詞尾那一側的耦合
 * （row：接後綴；word：就是詞尾）。兩側各是所有詞綴鏈的逐項最小值（定理 2），所以這就是所有分析中的最小值。
 * 詞幹結尾接後綴時可以還原構詞音變（詞幹開頭接在前綴之後時同理），加上那條規則的成本。
 * 回傳與 FuzzyIndex.searchChannels 相同形狀的結果（每個通道一個陣列，帶著出口），直接交給 finish。
 * 每個通道 O(n²)。
 * @param options.keep 哪些詞幹要（例如不在詞庫中、形狀像詞根）
 * @param options.bound 成本上限
 */
export function openStems(ctx: MorphContext, prepared: Prepared, { keep, bound }: { keep: (stem: string) => boolean; bound: number }): StemResult[][] {
  const { spec, isBoundary, junctionRules } = ctx
  return prepared.channels.map((ch) => {
    const q = ch.query
    const n = q.length
    const o = ch.options
    // 起點：通道的 from；沒有 from 時是詞首（只有 initialFrom 的通道，其他字元開頭的詞沒有起點，與走訪相同）
    const base = o.from ? o.from.row : o.initialFrom ? null : Float64Array.from({ length: n + 1 }, (_, x) => (x === 0 ? 0 : Infinity))
    const junctionStart = Boolean(o.from) && o.startEdge !== EDGE_WORD
    const to = o.to as JunctionEnd
    const out = new Map<string, StemResult>()
    const put = (stem: string, cost: number, kind: 'row' | 'word', x: number) => {
      if (cost > bound + EPSILON || Array.from(stem).length < spec.minStem || !keep(stem)) return
      const prev = out.get(stem)
      if (!prev || cost < prev.distance - EPSILON) out.set(stem, { term: stem, payloads: [], distance: cost, exit: { kind, x, tail: -1 } })
    }
    /** 底層的第一個字元決定起點（要求詞根元音開頭的環綴另有起點） */
    const startOf = (i: number, first: string) => (o.initialFrom?.initials.has(first) ? o.initialFrom.from.row[i] : (base?.[i] ?? Infinity))
    for (let i = 0; i < n; i++) {
      let span = ''
      for (let j = i + 1; j <= n; j++) {
        if (isBoundary(q[j - 1])) break // 開放詞幹是單一個詞
        span += q[j - 1]
        const endJ = to.row ? to.row[j] : Infinity
        const endW = to.word ? to.word[j] : Infinity
        // 詞幹的開頭：原樣，或（接在前綴之後時）還原一條構詞音變；結尾：原樣，或（接後綴時）還原一條。兩端可以同時
        const heads: Array<{ head: string; skip: number; cost: number }> = [{ head: '', skip: 0, cost: 0 }]
        if (junctionStart) for (const r of junctionRules) if (r.position !== 'final' && span.startsWith(r.source)) heads.push({ head: r.target, skip: r.source.length, cost: r.weight })
        const tails: Array<{ tail: string; skip: number; cost: number; kind: 'row' | 'word' }> = [{ tail: '', skip: 0, cost: Math.min(endJ, endW), kind: endJ <= endW ? 'row' : 'word' }]
        if (endJ < Infinity) for (const r of junctionRules) if (r.position !== 'initial' && span.endsWith(r.source)) tails.push({ tail: r.target, skip: r.source.length, cost: endJ + r.weight, kind: 'row' })
        for (const h of heads) {
          for (const t of tails) {
            if (t.cost === Infinity || h.skip + t.skip > span.length) continue
            const stem = h.head + span.slice(h.skip, span.length - t.skip) + t.tail
            if (!stem) continue
            const F = startOf(i, Array.from(stem)[0])
            if (F < Infinity) put(stem, F + h.cost + t.cost, t.kind, j)
          }
        }
      }
    }
    return [...out.values()]
  })
}
