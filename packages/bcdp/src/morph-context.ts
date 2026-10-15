/**
 * @file 構詞搜尋器的共用部分（MorphContext）：詞綴與環綴兩側的 trie、中綴與重疊的用法、詞根成本、快取。
 * 只依構詞規格與距離函式，建立時算好一次，之後每個查詢共用。
 */

import { FuzzyIndex } from './fuzzy-index.ts'
import { circumfixStep, rootCostOf, type Gloss, type Part } from './morphology.ts'
import type { Circumfix, Level, MorphContext, MorphSearchDeps, MorphStepHit, OpUse } from './morph-types.ts'
import type { ReduplicationPattern } from './morphology-spec.ts'

/** 詞綴鏈的快取上限（同一個網頁工作階段中重複查詢時省下重算） */
const CACHE_LIMIT = 500

/** 反轉字串（以 code point 為單位） */
export const reverse = (s: string) => Array.from(s).reverse().join('')

export function createContext({ analyzer, metric, index, isEntry = () => true }: MorphSearchDeps): MorphContext {
  const spec = analyzer.spec
  const mirror = metric.mirror()
  const prefixIndex = new FuzzyIndex(metric)
  for (const a of spec.prefixes) prefixIndex.add(a.form, a)
  const suffixIndex = new FuzzyIndex(mirror)
  for (const a of spec.suffixes) suffixIndex.add(reverse(a.form), a)
  const rules = metric.ruleSet.expand(metric.normalize)
  const junctionInserts = [...new Set(rules.filter((r) => r.target === '' && r.source !== '' && r.position !== 'final').map((r) => r.source))].map((s) => Array.from(s))

  const circumfixes: ReadonlyArray<Circumfix> = spec.circumfixes ?? []
  const innerPrefix = (c: Circumfix) => (c.kind === 'prefix' ? c.left : c.outer)
  const circPrefixIndex = new FuzzyIndex(metric)
  for (const c of circumfixes) {
    const left = innerPrefix(c)
    if (left && !circPrefixIndex.lookup(left)) circPrefixIndex.add(left, left)
  }
  const circSuffixIndex = new FuzzyIndex(mirror)
  for (const c of circumfixes) if (c.suffix && !circSuffixIndex.lookup(reverse(c.suffix))) circSuffixIndex.add(reverse(c.suffix), c.suffix)
  // 不隨查詢改變的步驟（單獨的中綴、前綴式與中綴式環綴）只建一次、凍結，每個查詢共用；
  // 重疊的步驟帶著查詢中的重疊部分，每次另建
  const fixedSteps = new Map<Circumfix, MorphStepHit>()
  const stepOf = (c: Circumfix) => {
    let s = fixedSteps.get(c)
    if (!s) fixedSteps.set(c, (s = Object.freeze(circumfixStep(c, c.left))))
    return s
  }
  const infixUses: Array<OpUse & { form: string }> = []
  for (const x of spec.infixes) {
    const s = Object.freeze(opStep('infix', x.form, x))
    infixUses.push({ form: x.form, op: () => s, circumfix: null, outer: '', rank: x.rank })
  }
  for (const c of circumfixes) if (c.kind === 'infix') infixUses.push({ form: c.left, op: () => stepOf(c), circumfix: c, outer: c.outer, rank: c.rank })
  const redupUses: Array<OpUse & { pattern: ReduplicationPattern }> = []
  for (const r of spec.reduplication) redupUses.push({ pattern: r.pattern, op: (red) => ({ ...opStep('reduplication', red, r), pattern: r.pattern }), circumfix: null, outer: '', rank: r.rank })
  for (const c of circumfixes) if (c.kind === 'reduplication') redupUses.push({ pattern: c.left as ReduplicationPattern, op: (red) => circumfixStep(c, red), circumfix: c, outer: c.outer, rank: c.rank })
  const syllableCost = rootCostOf(spec)
  const rootCost = (term: string) => syllableCost(term, isEntry(term))

  return {
    analyzer,
    spec,
    metric,
    mirror,
    index,
    prefixIndex,
    suffixIndex,
    circPrefixIndex,
    circSuffixIndex,
    circumfixes,
    isBoundary: (ch) => ch !== undefined && metric.boundaries.has(ch),
    junctionInserts,
    junctionRules: rules.filter((r) => r.junction),
    innerPrefix,
    stepOf,
    infixUses,
    redupUses,
    outers: [...new Set(['', ...infixUses.map((u) => u.outer), ...redupUses.map((u) => u.outer)])],
    vowelSet: new Set(Array.from(spec.vowels)),
    syllableCost,
    rootCost,
    hasRootCost: spec.rootSyllableCost.entry.length > 0,
    cache: new Map(),
  }
}

/**
 * 以快取鍵取用 ctx.cache（最近使用的移到最後；超過上限時丟掉最久沒用的），沒有時才計算。
 */
export function cached<T extends Level[] | Map<string, Level>>(ctx: MorphContext, key: string, compute: () => T): T {
  const cache = ctx.cache
  const hit = cache.get(key) as T | undefined
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const value = compute()
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return value
}

/** 詞幹上的中綴、重疊（單獨的步驟）：form 是中綴，或查詢中的重疊部分。 */
export function opStep(type: 'infix' | 'reduplication', form: string, e: { gloss: Gloss; cost: number; parts?: readonly Part[] }): MorphStepHit {
  return { type, form, gloss: e.gloss, cost: e.cost, ...(e.parts ? { parts: e.parts } : {}) }
}
