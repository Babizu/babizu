/**
 * @file 構詞搜尋的第一步：算好前綴、後綴的各層、環綴兩側與還原變體，產生詞幹的搜尋通道；
 * 走訪之前給相對上限一個起點（seed）。
 */

import { EDGE_JUNCTION, EDGE_WORD, EPSILON, roundCost } from './dp.ts'
import type { FuzzyIndex, SpreadCutoff } from './fuzzy-index.ts'
import { requireCost, requireString } from './guards.ts'
import { copyTagged, emptyEnd, emptyJunction, mergeEndInto, mergeInto, mergeTagged, minOf, toForwardEnd, type JunctionEnd } from './junction.ts'
import { byRank, levels, sides } from './morph-levels.ts'
import type { Circumfix, Level, MorphContext, MorphStepHit, Prepared, RestoredVariant, StemChannel, Variant, VariantMember } from './morph-types.ts'
import { restored } from './morph-variants.ts'

/** 還原變體（中綴、重疊）的上限：防止很長的查詢展開成上百個通道；超過時 prepare 的結果標記 truncated */
const MAX_VARIANTS = 64

/**
 * 算好前綴、後綴的各層與還原變體，產生詞幹的搜尋通道（交給 FuzzyIndex.searchChannels，
 * 搜尋引擎把它們與普通模糊搜尋合併成一次走訪）。
 * @param query 已正規化的查詢（搜尋鍵）
 * @param maxDistance 總成本上限
 * @returns 查詢太短時為 null
 */
export function prepare(ctx: MorphContext, query: string, maxDistance = 1): Prepared | null {
  const { spec, mirror, prefixIndex, suffixIndex, circPrefixIndex, circSuffixIndex, circumfixes, innerPrefix, stepOf, vowelSet, hasRootCost, rootCost } = ctx
  requireString(query, '查詢')
  requireCost(maxDistance, 'maxDistance ')
  const chars = Array.from(query)
  const n = chars.length
  if (n < spec.minStem + 1) return null
  const prefixLevels = levels(ctx, prefixIndex, chars, maxDistance, 'p')
  const suffixLevels = levels(ctx, suffixIndex, [...chars].reverse(), maxDistance, 's')
  const P: Level = emptyJunction(n)
  prefixLevels.forEach((L, s) => mergeInto(P, L, 0, s + 1))
  const S = emptyEnd(n)
  suffixLevels.forEach((L, s) => mergeEndInto(S, toForwardEnd(L, mirror.compiled), s + 1))
  const word = new Float64Array(n + 1).fill(Infinity)
  word[n] = 0
  // 只保留「最佳 ＋ lemmaSpread」之內的詞根（finish），所以各通道共用一個相對上限，隨途中的最佳收緊。
  // 算進最佳的詞與 finish 相同（不是查詢本身、夠長），結果與不收緊時完全相同
  // 詞根成本（rootSyllableCost）也算進最佳：finish 比的是加上它的總成本。中途的剪枝比的是不含它的成本（下界），仍然精確
  const cutoff: SpreadCutoff = {
    best: Infinity,
    spread: spec.lemmaSpread,
    eligible: (term: string) => term !== query && Array.from(term).length >= spec.minStem,
    ...(hasRootCost ? { termCost: rootCost } : {}),
  }

  const variants: Variant[] = []
  const channels: StemChannel[] = []
  // 環綴的兩側：各自是最內層（緊貼詞幹），外面可以再接一般的詞綴鏈
  const Sm: Level = emptyJunction(n)
  suffixLevels.forEach((L, s) => mergeInto(Sm, L, 0, s + 1))
  const circSuffixes = circumfixes.some((c) => c.suffix) ? sides(ctx, circSuffixIndex, [...chars].reverse(), Sm, maxDistance, 'cs') : new Map<string, Level>()
  const circ: Prepared['circ'] = {
    P: circumfixes.some((c) => innerPrefix(c)) ? sides(ctx, circPrefixIndex, chars, P, maxDistance, 'cp') : new Map(),
    Sm,
    S: new Map([...circSuffixes].map(([form, L]) => [form, { mirror: L, end: toForwardEnd(L, mirror.compiled) }])),
  }

  const plain = { start: -1, prefixed: false, cut: n, len: 0, ends: () => true, circumfix: null, suffix: null }
  // 沒有前綴：至少要有一個後綴
  if (suffixLevels.length) {
    variants.push({ kind: 'plain', chars, op: null, startEdge: EDGE_WORD, ...plain })
    channels.push({ query: chars, options: { maxDistance, cutoff, to: { row: S.row, pending: S.pending, word: null } } })
  }
  // 至少一個前綴：之後可以接後綴，也可以就是詞尾
  if (prefixLevels.length) {
    variants.push({ kind: 'prefix', chars, op: null, startEdge: EDGE_JUNCTION, ...plain })
    channels.push({ query: chars, options: { maxDistance, cutoff, from: P, to: { row: S.row, pending: S.pending, word } } })
  }
  // 前綴式的環綴：詞幹由它的左邊出發（成本加在起點），詞尾一定接它的後綴。後綴相同的環綴詞尾耦合的對象相同，
  // 所以它們的起點（左邊的狀態加上環綴的成本）逐項取 min 合併成一個通道（定理 2）；tag 記著是哪一個環綴。
  // 要求詞根元音開頭的（vowelStem）另外合併成一個起點，只給以元音開頭的詞用（FuzzyIndex 的 initialFrom）：
  // 通道還是同一個，詞圖只走一次。沒有後綴的只有這一種，它們的詞尾與「接在前綴之後」的通道相同，併進那個通道
  const byEnd = new Map<string, { start: Level | null; startV: Level | null; options: MorphStepHit[]; optionsV: MorphStepHit[] }>()
  for (const c of circumfixes) {
    const Pc = c.kind === 'prefix' ? circ.P.get(c.left) : undefined
    if (!Pc || (c.suffix && !circ.S.has(c.suffix))) continue
    let group = byEnd.get(c.suffix)
    if (!group) byEnd.set(c.suffix, (group = { start: null, startV: null, options: [], optionsV: [] }))
    const step = stepOf(c)
    if (c.vowelStem) {
      mergeInto((group.startV ??= emptyJunction(n)), Pc, c.cost, c, byRank)
      group.optionsV.push(step)
    } else {
      mergeInto((group.start ??= emptyJunction(n)), Pc, c.cost, c, byRank)
      group.options.push(step)
    }
  }
  /**
   * 把要求元音開頭的環綴併進通道 k：以元音開頭的詞由「原本的起點 ∪ 它們的起點」出發（定理 2）。
   * 合併時每一格保留來源；同分依同分規則（步驟少的，再依規格的順序）
   */
  const addVowelStart = (k: number, startV: Level, optionsV: MorphStepHit[]) => {
    const { options } = channels[k]
    const from = options.from as Level | undefined
    const start = from ? mergeTagged(copyTagged(from), startV, fewerSteps(prefixLevels[0])) : startV
    options.initialFrom = { initials: vowelSet, from: start }
    variants[k].alt = { options: optionsV, start }
  }
  for (const [suffix, { start, startV, options, optionsV }] of byEnd) {
    const end = suffix ? (circ.S.get(suffix) as { end: JunctionEnd }).end : { row: S.row, pending: S.pending }
    // 起點與詞尾的成本都不小於它們的最小值：加起來已經超過上限的起點不可能有命中
    const endMin = Math.min(...(end.row as Float64Array), ...end.pending.map((q) => Math.min(...q.row)), suffix ? Infinity : 0)
    const reach = (L: Level | null): L is Level => L !== null && minOf(L) + endMin <= maxDistance + EPSILON
    const V = reach(startV) ? startV : null
    if (!suffix) {
      // 沒有後綴的只有要求元音開頭的：併進「接在前綴之後」的通道（沒有那個通道時另建一個，只給元音開頭的詞）
      if (!V) continue
      let k = variants.findIndex((v) => v.kind === 'prefix')
      if (k === -1) {
        k = variants.push({ kind: 'prefix', chars, op: null, startEdge: EDGE_JUNCTION, ...plain, noBase: true }) - 1
        channels.push({ query: chars, options: { maxDistance, cutoff, to: { row: S.row, pending: S.pending, word } } })
      }
      addVowelStart(k, V, optionsV)
      continue
    }
    const base = reach(start) ? start : null
    if (!base && !V) continue
    const k = variants.push({ kind: 'circumfix', chars, op: null, startEdge: EDGE_JUNCTION, ...plain, suffix, options, ...(base ? {} : { noBase: true }) }) - 1
    channels.push({ query: chars, options: { maxDistance, cutoff, ...(base ? { from: base } : {}), to: { row: end.row, pending: end.pending, word: null } } })
    if (V) addVowelStart(k, V, optionsV)
  }
  // 還原變體：同一個位置、同一種拿法（shape）的變體，拿掉之後的查詢、詞幹的起點與可以結束的位置都相同，
  // 只差在步驟成本與詞尾接什麼（單獨的中綴、重疊接一般的後綴鏈或就是詞尾；環綴接它的後綴）。
  // 把步驟成本移到詞尾（加法可以交換），詞尾取各步驟的最小值，就能共用一個通道（(min, +) 線性）
  const groups = new Map<string, { v: RestoredVariant; members: VariantMember[] }>()
  for (const v of restored(ctx, chars, P, circ.P, circ.S)) {
    let group = groups.get(v.shape)
    if (!group) groups.set(v.shape, (group = { v, members: [] }))
    const op = v.op as MorphStepHit
    group.members.push({ op, circumfix: v.circumfix, suffix: v.suffix, cost: op.cost, rank: v.rank })
  }
  let truncated = false
  let count = 0
  for (const { v, members } of groups.values()) {
    if (count++ >= MAX_VARIANTS) {
      truncated = true
      break
    }
    const m = v.chars.length
    const original = (x: number) => (x > v.cut ? x + v.len : x) // 變體上的位置 → 原查詢
    const from = new Float64Array(m + 1).fill(Infinity)
    from[v.start] = v.startCost
    const row = new Float64Array(m + 1).fill(Infinity)
    const vWord = new Float64Array(m + 1).fill(Infinity)
    for (const member of members) {
      const endRow = member.suffix === null ? S.row : ((circ.S.get(member.suffix) as { end: JunctionEnd }).end.row as Float64Array)
      for (let x = 0; x <= m; x++) if (v.ends(x)) row[x] = Math.min(row[x], member.cost + endRow[original(x)])
      if (member.suffix === null && v.ends(m)) vWord[m] = Math.min(vWord[m], member.cost)
    }
    const first = members[0]
    variants.push({ ...v, op: first.op, circumfix: first.circumfix, suffix: first.suffix, members, ...(members.length > 1 ? { options: members.map((x) => x.op) } : {}) })
    channels.push({
      query: v.chars,
      options: { maxDistance, cutoff, from: { row: from, pending: [] }, startEdge: v.startEdge, to: { row, pending: [], word: vWord } },
    })
  }
  return { query, chars, prefixLevels, suffixLevels, P, S, circ, variants, channels, cutoff, truncated }
}

/**
 * 走訪之前先給相對上限一個起點：詞幹與查詢的一段完全相同、兩側直接接上已算好的詞綴各層，
 * 這是一個真的分析，所以它的成本不小於最後的最佳（上限只會更緊、結果不變）。
 * 成本要與 finish 的相同：含詞根音節數的成本（rootSyllableCost）。少算的話起點比真正的最佳低，
 * 走訪會剪掉「最佳 ＋ lemmaSpread」之內的詞根（單音節的詞根最便宜、雙音節的稍貴時）。
 * 只查 idx 裡的詞：走訪的是哪個詞庫，就只能用哪個詞庫的詞當起點。
 * @param prepared null 原樣傳回，方便接在 prepare 之後
 * @param idx 接下來要走訪的詞庫（預設是建立時的詞庫）
 */
export function seed<T extends Prepared | null>(ctx: MorphContext, prepared: T, idx: FuzzyIndex = ctx.index): T {
  const { spec, hasRootCost, rootCost } = ctx
  if (!prepared) return prepared
  const { chars, P, S, cutoff } = prepared
  const n = chars.length
  for (let x = 0; x + spec.minStem <= n; x++) {
    // 沒有前綴（一定要有後綴），或接在前綴之後（後綴可有可無）
    const bare = x === 0 ? 0 : Infinity
    const prefixed = P.row[x]
    if (bare === Infinity && prefixed === Infinity) continue
    let term = chars.slice(x, x + spec.minStem - 1).join('')
    for (let y = x + spec.minStem; y <= n; y++) {
      term += chars[y - 1]
      const cost = Math.min(bare + S.row[y], prefixed + (y === n ? 0 : S.row[y]))
      if (cost >= cutoff.best || term === prepared.query || idx.dawg.lookup(term) === -1) continue
      const total = hasRootCost ? roundCost(cost + rootCost(term)) : cost
      if (total < cutoff.best) cutoff.best = total
    }
  }
  return prepared
}

/**
 * 要求元音開頭的環綴的起點併進原本的起點時的同分規則（morph-grammar.md 2.4）：步驟少的優先，再依規格的順序。
 * 原本的起點若是前綴鏈，tag 是層數（步驟數）；只有一層時，比較的是第一層那一格的前綴。
 * @param first 第一層前綴的狀態（tag 是前綴）
 */
const fewerSteps = (first: Level | undefined) => (tag: Circumfix, current: unknown, x: number, node: number | null): boolean => {
  if (current === null || current === undefined) return true
  if (typeof current !== 'number') return byRank(tag, current as { rank: number })
  if (current > 1) return true
  const affix = (node === null ? first?.tags?.row[x] : first?.tags?.pending.get(node)?.[x]) as { rank: number } | null | undefined
  return !affix || tag.rank < affix.rank
}
