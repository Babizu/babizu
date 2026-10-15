/**
 * @file 構詞搜尋的說明：命中的整詞對齊（explainHit）、音變落在哪個詞素（notesOf），
 * 以及給演算法實驗室逐步展示的中間結果（explain）。
 */

import type { Explanation, SegmentOptions, WeightedEditDistance } from './distance.ts'
import { roundCost } from './dp.ts'
import { FuzzyIndex, type NodeVisit } from './fuzzy-index.ts'
import { finish } from './morph-finish.ts'
import { prepare, seed } from './morph-prepare.ts'
import type { MorphContext, MorphHit, Prepared, SoundNote } from './morph-types.ts'

/** explainHit 的一段（詞素） */
export interface Segment {
  chars: string[]
  lock: boolean
  type: 'prefix' | 'stem' | 'suffix'
  form: string
}

/** 指定的詞根命中時，整個詞的對齊（explain 的 alignment；∞ 寫成 null） */
export interface MorphAlignment {
  /** 還原變體的字元 */
  query: string[]
  /** 詞素：前綴、詞幹、後綴（length 是字元數） */
  segments: Array<{ type: Segment['type']; form: string; length: number }>
  /** 詞素交界在詞上的位置 */
  junctions: number[]
  distance: number
  matrix: Array<Array<number | null>>
  path: Explanation['path']
  steps: Explanation['alignment']
}

/** 指定的詞根不在命中裡的原因 */
export type MissReason = 'same' | 'short' | 'spread' | 'bound'

/**
 * 命中的完整說明：整個詞的聯合對齊（metric.explainSegments），各詞素依序接起來，
 * 變體的交界固定在查詢的位置上。對齊的距離加上步驟成本就是命中的成本（測試逐一比對）。
 */
export function explainHit(ctx: MorphContext, prepared: Prepared, hit: MorphHit) {
  const { metric, innerPrefix } = ctx
  const v = prepared.variants[hit.analysis.variant]
  const { prefixes, suffixes, circumfix } = hit.analysis
  const affix = (type: 'prefix' | 'suffix', form: string): Segment => ({ chars: Array.from(form), lock: true, type, form })
  // 環綴緊貼詞幹：前綴式的左邊（或中綴、重疊式外側的前綴）是最內層的前綴，後綴是最內層的後綴
  // （中綴、重疊在詞幹上，變體已經拿掉）
  const innerForm = circumfix ? innerPrefix(circumfix) : ''
  const inner = innerForm ? [affix('prefix', innerForm)] : []
  const segments: Segment[] = [
    ...prefixes.map((a) => affix('prefix', a.form)),
    ...inner,
    { chars: Array.from(hit.term), lock: false, type: 'stem', form: hit.term },
    ...(circumfix?.suffix ? [affix('suffix', circumfix.suffix)] : []),
    // 後綴由外而內，在詞中的順序要反過來
    ...[...suffixes].reverse().map((a) => affix('suffix', a.form)),
  ]
  const stem = prefixes.length + inner.length
  const options: SegmentOptions = {}
  if (v.kind === 'infix' || v.kind === 'reduplication') {
    if (stem === 0) options.startEdge = v.startEdge
    options.pinStart = { segment: stem, x: v.start }
    options.pinEnd = { segment: stem, allowed: new Set(Array.from({ length: v.chars.length + 1 }, (_, x) => x).filter(v.ends)) }
  }
  return { query: v.chars, segments, stem, explanation: metric.explainSegments(v.chars, segments, options) }
}

/**
 * 命中的音變說明：整個詞的對齊中不是「相同」的每一步，標出它落在哪裡——前綴、詞幹、後綴，
 * 或詞素交界（只動查詢的操作在交界上，或規則跨越了交界）。成本加起來是整個詞的音變。
 */
export function notesOf(ctx: MorphContext, prepared: Prepared, hit: MorphHit): SoundNote[] {
  const { segments, explanation } = explainHit(ctx, prepared, hit)
  const junctions = new Set(explanation.junctions)
  const typeAt = (j: number) => segments[explanation.segmentOf[j]]?.type ?? 'stem'
  return explanation.alignment
    .filter((s) => s.op !== 'match')
    .map((s) => {
      const [, b0] = s.from
      const [, b] = s.to
      let where: SoundNote['where']
      if (b0 === b) where = junctions.has(b) ? 'junction' : typeAt(Math.max(0, b - 1))
      else where = explanation.segmentOf[b0] === explanation.segmentOf[b - 1] ? typeAt(b0) : 'junction'
      return { op: s.op, source: s.source, target: s.target, cost: s.cost, category: s.rule?.category ?? null, where }
    })
}

/**
 * 說明一次構詞搜尋：各階段的中間結果，給演算法實驗室逐步展示（docs/lab-design.md）。
 * 與 search 走同一套程式，所以 hit 一定等於搜尋對這個詞的結果（測試逐一比對）。
 * 回傳值只含可以結構化複製的資料，∞ 寫成 null，可以從 Web Worker 傳回。
 * @param query 已正規化的查詢（搜尋鍵）
 * @param term 要說明的詞根（省略時只列出命中）
 * @param options.maxDistance 總成本上限（與 search 相同）
 */
export function explain(ctx: MorphContext, query: string, term: string | null = null, { maxDistance = 1 }: { maxDistance?: number } = {}) {
  const { spec, metric, index } = ctx
  const chars = Array.from(query)
  const params = { maxSteps: spec.maxSteps, minStem: spec.minStem, lemmaSpread: spec.lemmaSpread, maxDistance }
  const prepared = prepare(ctx, query, maxDistance)
  if (!prepared) return { query, chars, params, tooShort: true as const, term, reason: term === null ? null : ('short' as MissReason) }
  const walks: NodeVisit[][] = prepared.channels.map(() => [])
  seed(ctx, prepared)
  const results = index.searchChannels(prepared.channels.map((ch, c) => ({ query: ch.query, options: { ...ch.options, onNode: (e: NodeVisit) => walks[c].push(e) } })))
  const hits = finish(ctx, prepared, results, maxDistance)
  const cutoff = hits.length ? roundCost(hits[0].distance + spec.lemmaSpread) : null
  const finite = (x: number) => (x === Infinity ? null : roundCost(x))
  const rowOf = (row: ArrayLike<number>) => Array.from(row, finite)

  let hit: MorphHit | null = null
  let alignment: MorphAlignment | null = null
  /** 找不到 term 的原因 */
  let reason: MissReason | null = null
  if (term !== null) {
    hit = hits.find((h) => h.term === term) ?? null
    if (hit) {
      const x = explainHit(ctx, prepared, hit)
      const e = x.explanation
      alignment = {
        query: x.query,
        segments: x.segments.map((s) => ({ type: s.type, form: s.form, length: s.chars.length })),
        junctions: e.junctions,
        distance: e.distance,
        matrix: e.matrix.map((r) => r.map((c) => (c === Infinity ? null : c))),
        path: e.path,
        steps: e.alignment,
      }
    } else if (term === query) reason = 'same'
    else if (Array.from(term).length < spec.minStem) reason = 'short'
    else reason = whyMissing(metric, prepared, term)
  }
  return {
    query,
    chars,
    params,
    tooShort: false as const,
    prefixLevels: prepared.prefixLevels.map((L) => rowOf(L.row)),
    suffixLevels: prepared.suffixLevels.map((L) => rowOf(Float64Array.from(L.row).reverse())),
    merged: {
      P: rowOf(prepared.P.row),
      S: rowOf(prepared.S.row),
      crossingP: prepared.P.pending.map((p) => ({ head: metric.compiled.trieString(p.node), row: rowOf(p.row) })),
      crossingS: prepared.S.pending.map((p) => ({ tail: p.tail.join(''), row: rowOf(p.row) })),
    },
    variants: prepared.variants.map((v) => ({
      kind: v.kind,
      text: v.chars.join(''),
      chars: [...v.chars],
      op: v.op,
      options: v.options ?? null,
      start: v.start,
      prefixed: v.prefixed,
      suffix: v.suffix,
      alt: v.alt ? { options: v.alt.options } : null,
      noBase: v.noBase ?? false,
    })),
    truncated: prepared.truncated,
    candidates: results.map((list) => list.map((r) => ({ term: r.term, distance: r.distance, exit: r.exit ?? null }))),
    walks: walks.map((events) => events.map((e) => ({ ...e, lowerBound: finite(e.lowerBound) }))),
    hits,
    cutoff,
    term,
    hit,
    alignment,
    reason,
  }
}

/**
 * 夠長、卻不在命中裡的詞根，是被相對上限（最佳 ＋ lemmaSpread）截掉，還是本來就超過總成本上限：
 * 走訪用了相對上限，被截斷的詞可能根本沒走到，所以只對這個詞、不收緊上限再算一次。
 */
function whyMissing(metric: WeightedEditDistance, prepared: Prepared, term: string): 'spread' | 'bound' {
  const single = new FuzzyIndex(metric).addAll([[term, null]])
  const alone = single.searchChannels(prepared.channels.map((ch) => ({ query: ch.query, options: { ...ch.options, cutoff: undefined } })))
  return alone.flat().length ? 'spread' : 'bound'
}
