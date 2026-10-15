/**
 * @file 構詞搜尋的第二步：整理各通道的結果，每個詞取最小成本，找出是哪些詞綴，成本相同時依固定的規則選說明。
 */

import { EPSILON, roundCost } from './dp.ts'
import { affixesOf, type AffixAnalysis } from './morph-trace.ts'
import type { AffixEntry, MorphContext, MorphHit, MorphStepHit, Prepared, StemResult } from './morph-types.ts'

/**
 * 整理各通道的結果，每個詞取最小成本，並找出是哪些詞綴。
 * @param resultsPerChannel 與 prepared.channels 對應
 * @param maxDistance 總成本上限
 * @returns 依成本排序（同分依詞），只保留「最佳 ＋ lemmaSpread」之內
 */
export function finish(ctx: MorphContext, prepared: Prepared, resultsPerChannel: StemResult[][], maxDistance: number): MorphHit[] {
  const { spec, hasRootCost, rootCost } = ctx
  const { query } = prepared
  const best = new Map<string, { distance: number; term: string; candidates: Array<{ channel: number; result: StemResult }> }>()
  prepared.channels.forEach((_, c) => {
    for (const r of resultsPerChannel[c] ?? []) {
      if (r.term === query || Array.from(r.term).length < spec.minStem || r.distance > maxDistance + EPSILON) continue
      // 成本＝走訪的成本（步驟＋音變）＋詞根成本。上限比的是走訪的成本：詞根成本只改名次與候選範圍（最佳 ＋ lemmaSpread），
      // 不讓本來在上限內的分析因為它消失（罕見而正確的詞根不能被排除）
      const distance = hasRootCost ? roundCost(r.distance + rootCost(r.term)) : r.distance
      const prev = best.get(r.term)
      if (!prev || distance < prev.distance - EPSILON) best.set(r.term, { distance, term: r.term, candidates: [{ channel: c, result: r }] })
      else if (distance <= prev.distance + EPSILON) prev.candidates.push({ channel: c, result: r })
    }
  })
  const sorted = [...best.values()].sort((a, b) => a.distance - b.distance || (a.term < b.term ? -1 : 1))
  if (sorted.length === 0) return []
  const cutoff = sorted[0].distance + spec.lemmaSpread + EPSILON
  return sorted
    .filter((h) => h.distance <= cutoff)
    .map((h) => {
      // 成本相同的分析（不同通道）：說明選步驟少的，再依規格中的順序（tieKey）；成本不受影響。
      // 其他步驟不同的分析也留著（ties）：表面相同的不同讀法，拆解表要每一種都有
      let pick: { channel: number; result: StemResult; a: AffixAnalysis; key: number[] } | null = null
      const all: MorphStepHit[][] = []
      for (const { channel, result } of h.candidates) {
        const a = affixesOf(ctx, prepared, channel, result)
        all.push(stepsOf(a))
        const key = tieKey(a)
        if (!pick || compareKeys(key, pick.key) < 0) pick = { channel, result, a, key }
      }
      const { channel, result, a } = pick as NonNullable<typeof pick>
      const { prefixes, suffixes, circumfix } = a
      const steps = stepsOf(a)
      const seen = new Set([stepsKey(steps)])
      // 只收步驟成本也相同的讀法（音變的分量才相同）：多一個步驟、少一些音變的讀法（morohot 的 m- ＋ o~ ＋ ruhut）
      // 總成本相同，卻能鑽過精確模式「音變不超過 0.2」的上限，它不是同一種讀法的另一種寫法
      const stepCost = stepCostOf(steps)
      const ties: MorphStepHit[][] = []
      for (const s of all) {
        const k = stepsKey(s)
        if (!seen.has(k) && Math.abs(stepCostOf(s) - stepCost) <= EPSILON) seen.add(k), ties.push(s)
      }
      const rc = hasRootCost ? rootCost(result.term) : 0
      return {
        term: result.term,
        payloads: result.payloads,
        distance: roundCost(h.distance),
        ...(rc > 0 ? { rootCost: rc } : {}),
        steps,
        analysis: { variant: channel, prefixes, suffixes, circumfix },
        ...(ties.length ? { ties } : {}),
      }
    })
}

/** 一種分析的步驟：前綴（由外而內）、包覆單位、後綴（由外而內） */
function stepsOf(a: Pick<AffixAnalysis, 'prefixes' | 'suffixes' | 'op'>): MorphStepHit[] {
  return [...a.prefixes.map((x) => affixStep('prefix', x)), ...(a.op ? [a.op] : []), ...a.suffixes.map((x) => affixStep('suffix', x))]
}

/** 步驟成本的和 */
function stepCostOf(steps: MorphStepHit[]): number {
  return steps.reduce((x, s) => x + s.cost, 0)
}

/** 步驟的比較鍵（種類與寫法，由外而內） */
function stepsKey(steps: MorphStepHit[]): string {
  return steps.map((s) => `${s.type}:${s.form}`).join('\u0000')
}

function affixStep(type: 'prefix' | 'suffix', a: AffixEntry): MorphStepHit {
  return { type, form: a.form, gloss: a.gloss, cost: a.cost, ...(a.parts ? { parts: a.parts } : {}) }
}

/** 同分時比較分析的鍵：步驟數，再來是各步驟在規格中的順序（由小到大排好）。 */
function tieKey(a: AffixAnalysis): number[] {
  const ranks = [...a.prefixes.map((x) => x.rank), ...a.suffixes.map((x) => x.rank), ...(a.op ? [a.rank ?? Infinity] : [])].sort((x, y) => x - y)
  return [ranks.length, ...ranks]
}

/** 字典序比較 */
function compareKeys(x: number[], y: number[]): number {
  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return x[k] - y[k]
  return x.length - y.length
}
