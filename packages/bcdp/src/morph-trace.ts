/**
 * @file 命中是由哪些詞綴來的：走訪只得到成本；合併後的交界狀態每一格記著來源（tag），
 * 對命中的詞做追蹤 DP，一段一段往回追，就得到前綴鏈、包覆單位與後綴鏈（docs/bcdp.md 第 8 節）。
 */

import type { Entry, WeightedEditDistance } from './distance.ts'
import { EPSILON } from './dp.ts'
import type { JunctionEnd } from './junction.ts'
import type { AffixEntry, Circumfix, Level, MorphContext, MorphStepHit, Prepared, StemResult } from './morph-types.ts'

/** 一個命中的分析：前綴與後綴（由外而內）、包覆單位的步驟與環綴、包覆單位在規格中的順序 */
export interface AffixAnalysis {
  prefixes: AffixEntry[]
  suffixes: AffixEntry[]
  op: MorphStepHit | null
  circumfix: Circumfix | null
  /** 非串接步驟或環綴在規格中的順序（同分時說明選較前的；沒有時 null） */
  rank: number | null
}

/** 追蹤 DP 的出口（與走訪的出口同一種形狀：詞尾、交界列或跨界狀態） */
type TraceExit = { kind: string; x: number; tail?: number }

/**
 * 一格（交界列的第 x 格，或跨界狀態 node 的第 x 格）的 tag。
 * @param key 跨界狀態的鍵（預設 entry.node）
 */
export const tagAt = (state: { tags?: { row: unknown[]; pending: Map<unknown, unknown[]> } }, entry: Entry, key?: unknown): unknown => {
  if (entry.kind === 'start') return null
  if (entry.kind === 'row') return state.tags?.row[entry.x] ?? null
  return state.tags?.pending.get(key ?? entry.node)?.[entry.x] ?? null
}

/**
 * 由某一層的一格往回追出整條詞綴鏈：這一格記著是哪個詞綴；在那個詞綴上由前一層出發做一次追蹤 DP，
 * 找到它是由前一層的哪一格進來的，一直追到詞首（詞尾）。
 * @param m 距離函式（後綴用鏡像的）
 * @param list 各層
 * @param s 從第 s 層開始（1 起算）
 * @param x 查詢（後綴用反轉的查詢）
 * @param charsOf 詞綴的字元（後綴要反轉）
 * @returns 由外而內
 */
function chainFrom(m: WeightedEditDistance, list: Level[], s: number, entry: Entry, x: string[], charsOf: (form: string) => string[]): AffixEntry[] {
  const out: AffixEntry[] = []
  let at = entry
  for (let k = s; k >= 1 && at.kind !== 'start'; k--) {
    const affix = tagAt(list[k - 1], at) as AffixEntry | null
    if (!affix) break
    out.push(affix)
    const t = m.traceSegment(x, charsOf(affix.form), { from: k >= 2 ? list[k - 2] : null, lock: true, exit: at })
    at = t.entry
  }
  return out.reverse()
}

/**
 * 命中是由哪些詞綴來的：在詞幹上做一次追蹤 DP（與走訪同一個起點與耦合），得到它由合併後的前綴狀態的哪一格
 * 進來、在後綴狀態的哪一格出去，再各自往回追出詞綴鏈。
 * @param c 通道
 * @param result 這個通道走訪到的結果（帶著耦合的出口）
 */
export function affixesOf(ctx: MorphContext, prepared: Prepared, c: number, result: StemResult): AffixAnalysis {
  const { metric, mirror, vowelSet, stepOf } = ctx
  const v = prepared.variants[c]
  const options = prepared.channels[c].options
  // 以元音開頭的詞，在併進了要求元音開頭的環綴的通道上，由合併後的起點出發（與走訪相同）
  const start = v.alt && vowelSet.has(Array.from(result.term)[0]) ? v.alt.start : (options.from as Level | undefined)
  // 「接在前綴之後」與前綴式環綴的通道不知道詞幹從哪一格進來，要在詞幹上做一次追蹤 DP；其他通道的起點
  // 是詞首或固定的位置，出口走訪時已經記下（與追蹤 DP 的結果相同，所以不必再算）。
  // 命中的成本有限，所以追蹤 DP 一定找得到出口：耦合的出口已換成詞尾、交界列或跨界狀態（與走訪的出口同一種形狀）
  const t: { entry: Entry; exit: TraceExit } =
    v.kind === 'prefix' || v.kind === 'circumfix' || !result.exit
      ? (metric.traceSegment(v.chars, Array.from(result.term), {
          from: start ?? null,
          startEdge: options.startEdge,
          exit: { kind: 'couple', to: options.to as JunctionEnd },
        }) as { entry: Entry; exit: TraceExit })
      : { entry: { kind: 'start' }, exit: result.exit }
  // 詞綴鏈只取決於（哪一側、第幾層、從哪一格往回追），同一次查詢的命中常常共用，所以備忘在 prepared 上
  const memo = (prepared.chains ??= new Map())
  const chain = (side: string, level: number, at: Entry, compute: () => AffixEntry[]) => {
    const key = `${side}|${level}|${at.kind}|${'x' in at ? at.x : ''}|${'node' in at ? at.node : ''}`
    let out = memo.get(key)
    if (!out) memo.set(key, (out = compute()))
    return out.slice()
  }
  /** 由合併後的前綴狀態 P 的一格往回追出前綴鏈 */
  const prefixChain = (at: Entry) => {
    if (at.kind === 'start') return []
    const level = (tagAt(prepared.P, at) ?? 0) as number
    return chain('p', level, at, () => chainFrom(metric, prepared.prefixLevels, level, at, prepared.chars, (f) => Array.from(f)))
  }
  const reversed = [...prepared.chars].reverse()
  /** 由合併後的後綴狀態（鏡像座標）的一格往回追出後綴鏈 */
  const suffixChain = (at: Entry, level: number) => chain('s', level, at, () => chainFrom(mirror, prepared.suffixLevels, level, at, reversed, (f) => Array.from(f).reverse()))

  let prefixes: AffixEntry[]
  /** 這個命中用的非串接步驟或環綴 */
  let op = v.op
  let circumfix = v.circumfix
  let suffix = v.suffix
  /** 非串接步驟或環綴在規格中的順序（同分時說明選較前的） */
  let rank: number | null = v.members ? null : (v.circumfix?.rank ?? null)
  const n = prepared.chars.length
  if (v.members) {
    // 共用通道的變體：出口的成本是哪一個步驟給的（同分取規格中較前的）
    const exit = t.exit
    const x = exit.x > v.cut ? exit.x + v.len : exit.x
    let best = Infinity
    for (const member of v.members) {
      let cost = Infinity
      if (exit.kind === 'word') cost = member.suffix === null ? member.cost : Infinity
      else {
        const endRow = member.suffix === null ? prepared.S.row : ((prepared.circ.S.get(member.suffix) as { end: JunctionEnd }).end.row as Float64Array)
        cost = member.cost + endRow[x]
      }
      if (cost < best - EPSILON || (cost <= best + EPSILON && rank !== null && member.rank < rank)) {
        best = Math.min(best, cost)
        ;({ op, circumfix, suffix, rank } = member)
      }
    }
  }
  // 起點那一格的來源：前綴式環綴的通道一定是環綴；併進了元音開頭環綴的「接在前綴之後」通道，可能是環綴，
  // 也可能是原本的前綴鏈（tag 是層數）
  const startTag = v.kind === 'circumfix' || start !== options.from ? tagAt(start as Level, t.entry) : null
  if (startTag !== null && typeof startTag === 'object') {
    // 詞幹由合併後的起點進來：那一格的 tag 是哪一個環綴；環綴左邊的狀態再記著它是從詞首（0）
    // 還是從前綴鏈之後（1）走過來的
    circumfix = startTag as Circumfix
    suffix = circumfix.suffix || null
    op = stepOf(circumfix)
    rank = circumfix.rank
    const Pc = prepared.circ.P.get(circumfix.left) as Level
    if (tagAt(Pc, t.entry) === 1) {
      const back = metric.traceSegment(prepared.chars, Array.from(circumfix.left), { from: prepared.P, lock: true, exit: t.entry as Entry & { kind: 'row' | 'pending' } })
      prefixes = prefixChain(back.entry)
    } else prefixes = []
  } else if (v.outer) {
    // 包覆單位的前綴緊貼詞幹：詞幹起點那一格記著它是從詞首（0）還是從前綴鏈之後（1）走過來的，
    // 從前綴鏈之後時，在前綴上追一次，找到前綴鏈的終點再往回追（與前綴式環綴相同）
    const Pc = prepared.circ.P.get(v.outer) as Level
    const at: Entry = { kind: 'row', x: v.start }
    if (tagAt(Pc, at) === 1) {
      const back = metric.traceSegment(prepared.chars, Array.from(v.outer), { from: prepared.P, lock: true, exit: at })
      prefixes = prefixChain(back.entry)
    } else prefixes = []
  } else {
    // 變體的起點固定在 v.start（有前綴鏈時由合併後的前綴狀態的那一格往回追）
    prefixes = prefixChain(v.start >= 0 ? (v.prefixed ? { kind: 'row', x: v.start } : { kind: 'start' }) : t.entry)
  }

  // 後綴：出口換成反向座標（位置 x → n − x；跨界狀態的 tail 反轉後是鏡像 trie 的節點）
  const exit = t.exit
  let suffixes: AffixEntry[] = []
  if (exit.kind === 'row' || exit.kind === 'pending') {
    const x = exit.x > v.cut ? exit.x + v.len : exit.x
    const to = options.to as JunctionEnd
    const back: Entry =
      exit.kind === 'row'
        ? { kind: 'row', x: n - x }
        : { kind: 'pending', node: mirror.compiled.trieWalk(0, [...to.pending[exit.tail as number].tail].reverse()), x: n - x }
    if (suffix !== null) {
      // 環綴的後綴：它的狀態記著是從詞尾（0）還是從後綴鏈之前（1）走過來的
      const Sc = prepared.circ.S.get(suffix) as { mirror: Level }
      if (tagAt(Sc.mirror, back) === 1) {
        const e = mirror.traceSegment(reversed, Array.from(suffix).reverse(), { from: prepared.circ.Sm, lock: true, exit: back as Entry & { kind: 'row' | 'pending' } })
        if (e.entry.kind !== 'start') suffixes = suffixChain(e.entry, (tagAt(prepared.circ.Sm, e.entry) ?? 0) as number)
      }
    } else if (exit.kind === 'row') suffixes = suffixChain(back, (prepared.S.tags.row[x] ?? 0) as number)
    else {
      const tail = prepared.S.pending[exit.tail as number].tail
      suffixes = suffixChain(back, (prepared.S.tags.pending.get(tail.join(''))?.[x] ?? 0) as number)
    }
  }
  return { prefixes, suffixes, op, circumfix, rank }
}
