/**
 * @file 人工拆解對照：記錄的人工拆解（`morphology.segmentation`）與句型搜尋的構詞樣式比一比。
 * 檢查清單的「人工拆解對照」（checklist.ts）與評估工具共用，所以兩邊的準確與召回一定相同。
 *
 * ## 人工拆解的寫法
 * 依萊比錫標註規則（Leipzig Glossing Rules）：`-` 詞素界、`=` 附著詞界、`~` 重疊（`~` 前面那一段是重疊部分）、
 * `<x>` 中綴、`( )` 可省略的字母（拿掉括號、保留字母）。例如 `pa-ka-asikit`、`m<in>u-…`、`kipu~kipud-i`。
 * 每筆拆解取：最外層的前綴（第一段，不是詞根時）、最外層的後綴（最後一段，不是詞根時），以及所有中綴；
 * 拆解沒有標出哪一段是詞根，取最長的一段。
 *
 * ## 比對
 * 每個詞綴寫成構詞樣式（`x-…`、`…-x`、`<x>…`），由句型搜尋解析成同位詞素組（PatternSearch.morphRequirement）：
 * 同一組只算一次（mu-、mi-、m- 是一組）；解析不出單一個組的（構詞規格中沒有，或是幾個詞素的組合寫法）
 * 不比，另外列為「規格沒有的詞綴」。所有拆解中出現過的組就是要比的條件。
 * 一個詞符不符合一個條件，與句型搜尋比對構詞樣式是同一個判斷（PatternSearch.matchMorph：依模糊程度取到的拆法中
 * 有沒有符合的）。對每筆有拆解的記錄、每個條件：
 * - 拆解有、搜尋也比到：對；
 * - 搜尋比到、拆解沒有：誤配（拉低準確）；
 * - 拆解有、搜尋比不到：漏（拉低召回）。
 * 同一個詞有好幾筆拆解時（不同來源），「拆解有」是它們的聯集。
 * 準確 ＝ 對 ÷（對 ＋ 誤配），召回 ＝ 對 ÷（對 ＋ 漏）。
 */

import type { MorphStepHit } from '#bcdp'
import type { MorphRequirement } from '../pattern/morph.ts'
import type { CorpusRecord } from '../schema/types.ts'
import type { SearchEngine } from './engine.ts'
import type { Fuzziness } from './types.ts'

/** search/segmentations.json 的格式版本 */
export const SEGMENTATIONS_FORMAT_VERSION = 1

/** 有詞素界的拆解才收（沒有界的只是詞形本身，無從比對詞綴） */
const BOUNDARY = /[-=~<]/u

/** search/segmentations.json 的內容 */
export interface SegmentationData {
  version: number
  /** 記錄編號（docs.json 的順序）與它的人工拆解 */
  entries: Array<[number, string]>
}

/**
 * 建置：收集有人工拆解（含詞素界）的記錄。
 * @param items 順序即記錄編號（與 buildSearchIndex 相同）
 */
export function collectSegmentations(items: Array<{ record: CorpusRecord }>): SegmentationData {
  const entries: Array<[number, string]> = []
  items.forEach(({ record }, k) => {
    const seg = record.morphology?.segmentation
    if (typeof seg === 'string' && BOUNDARY.test(seg)) entries.push([k, seg])
  })
  return { version: SEGMENTATIONS_FORMAT_VERSION, entries }
}

type AffixType = 'prefix' | 'suffix' | 'infix'

/** 人工拆解中的一個詞綴（搜尋鍵） */
export interface GoldAffix {
  type: AffixType
  form: string
}

/**
 * 解析一筆人工拆解（寫法見檔頭）。
 * @returns 詞綴（最外層的前綴、最外層的後綴、所有中綴；搜尋鍵）與詞根；沒有任何一段時為 null
 */
export function parseSegmentation(segmentation: string, searchKey: (text: string) => string): { affixes: GoldAffix[]; root: string } | null {
  const parts = segmentation
    .replace(/=/gu, '-')
    .split(/(?=[-~])|(?<=[-~])/u)
    .filter(Boolean)
  const segs: string[] = []
  for (const p of parts) {
    if (p === '-') continue
    if (p === '~') segs.pop() // 重疊部分不是詞綴
    else segs.push(p)
  }
  const infixes: string[] = []
  const clean = segs.map((p) => p.replace(/<([^>]+)>/gu, (_, x: string) => (infixes.push(searchKey(x)), '')).replace(/[()]/gu, ''))
  if (clean.length === 0) return null
  let root = 0
  clean.forEach((p, k) => {
    if (p.length > clean[root].length) root = k
  })
  const prefix = root > 0 ? searchKey(clean[0]) : ''
  const suffix = root < clean.length - 1 ? searchKey(clean[clean.length - 1]) : ''
  const affixes: GoldAffix[] = [
    ...(prefix ? [{ type: 'prefix' as const, form: prefix }] : []),
    ...(suffix ? [{ type: 'suffix' as const, form: suffix }] : []),
    ...infixes.filter(Boolean).map((form) => ({ type: 'infix' as const, form })),
  ]
  return { affixes, root: searchKey(clean[root]) }
}

/** 要比的一個條件（一個同位詞素組） */
export interface SegmentationCondition {
  id: string
  type: AffixType
  /** 構詞樣式（`pa-…`），點了可以直接搜尋 */
  query: string
  /** 顯示用（`pa-`、`-an`、`<in>`） */
  label: string
}

/** 一筆有人工拆解的記錄 */
export interface SegmentationRow {
  /** 記錄編號 */
  doc: number
  /** 詞（記錄詞形的搜尋鍵） */
  word: string
  /** 人工拆解 */
  segmentation: string
  /** 拆解中的詞根（最長的一段，搜尋鍵） */
  root: string
  /** 詞根是詞庫中的詞（不是時，補上這個詞根的條目常常就拆得到） */
  rootInLexicon: boolean
  /** 拆解中的詞綴：比到、漏，或規格沒有（不比） */
  affixes: Array<GoldAffix & { condition: string | null; status: 'match' | 'miss' | 'unknown' }>
  /** 誤配：搜尋比到、拆解沒有的條件 */
  extras: string[]
  /** 這個詞依模糊程度取到的拆法（搜尋比對的就是這些；最多 3 種） */
  parses: Array<{ root: string; steps: MorphStepHit[]; cost: number; virtual: boolean }>
}

export interface SegmentationComparison {
  fuzziness: Fuzziness
  conditions: SegmentationCondition[]
  /** 依記錄編號 */
  rows: SegmentationRow[]
  /** 對、誤配、漏 */
  totals: { tp: number; fp: number; fn: number }
}

/**
 * 人工拆解與句型搜尋的構詞樣式對照（做法見檔頭）。需要拆解表（engine.parses）。
 * @param entries 記錄編號與人工拆解（SegmentationData 的 entries）
 * @returns 沒有構詞規格或拆解表時為 null
 */
export function compareSegmentations(engine: SearchEngine, entries: Array<[number, string]>, fuzziness: Fuzziness = 'normal'): SegmentationComparison | null {
  const pattern = engine.pattern
  if (!pattern.morphology || !engine.parses) return null
  const key = engine.text.searchKey
  const conditions = new Map<string, SegmentationCondition & { req: MorphRequirement }>()
  /** (類型, 寫法) → 條件 */
  const conditionOfAffix = new Map<string, string | null>()
  const conditionOf = (a: GoldAffix) => {
    const ck = `${a.type}\u0000${a.form}`
    let id = conditionOfAffix.get(ck)
    if (id !== undefined) return id
    const query = a.type === 'prefix' ? `${a.form}-…` : a.type === 'suffix' ? `…-${a.form}` : `<${a.form}>…`
    const req = pattern.morphRequirement(query)
    const groups = req ? [...req.prefixes, ...req.suffixes, ...req.infixes] : []
    id = null
    if (req && groups.length === 1) {
      id = `${a.type}:${[...groups[0].forms].sort().join(',')}`
      if (!conditions.has(id)) conditions.set(id, { id, type: a.type, query, label: groups[0].label, req })
    }
    conditionOfAffix.set(ck, id)
    return id
  }
  const parsed = entries.map(([doc, segmentation]) => {
    const gold = parseSegmentation(segmentation, key)
    const affixes = (gold?.affixes ?? []).map((a) => ({ ...a, condition: conditionOf(a) }))
    return { doc, segmentation, word: key(engine.docs.text[doc]), root: gold?.root ?? '', affixes }
  })
  /** 詞 → 拆解中的條件（同一個詞的幾筆拆解取聯集） */
  const truthOf = new Map<string, Set<string>>()
  for (const r of parsed) {
    let set = truthOf.get(r.word)
    if (!set) truthOf.set(r.word, (set = new Set()))
    for (const a of r.affixes) if (a.condition) set.add(a.condition)
  }
  /** (詞, 條件) → 搜尋比不比得到 */
  const memo = new Map<string, boolean>()
  const matched = (word: string, id: string) => {
    const mk = `${word}\u0000${id}`
    let m = memo.get(mk)
    if (m === undefined) {
      const c = conditions.get(id) as SegmentationCondition & { req: MorphRequirement }
      memo.set(mk, (m = pattern.matchMorph(word, c.req, fuzziness) !== null))
    }
    return m
  }
  const totals = { tp: 0, fp: 0, fn: 0 }
  const rows: SegmentationRow[] = parsed.map((r) => {
    const truth = truthOf.get(r.word) as Set<string>
    for (const id of conditions.keys()) {
      const got = matched(r.word, id)
      if (got && truth.has(id)) totals.tp++
      else if (got) totals.fp++
      else if (truth.has(id)) totals.fn++
    }
    return {
      ...r,
      rootInLexicon: r.root !== '' && engine.index.dawg.lookup(r.root) !== -1,
      affixes: r.affixes.map((a) => ({ ...a, status: a.condition === null ? 'unknown' : matched(r.word, a.condition) ? 'match' : 'miss' })),
      extras: [...conditions.keys()].filter((id) => !truth.has(id) && matched(r.word, id)),
      parses: pattern
        .parsesOf(r.word, fuzziness)
        .slice(0, 3)
        .map((p) => ({ root: p.root, steps: p.steps, cost: p.cost, virtual: p.virtual })),
    }
  })
  return { fuzziness, conditions: [...conditions.values()].map(({ req: _req, ...c }) => c), rows, totals }
}
