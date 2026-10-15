/**
 * @file 句型搜尋：在所有記錄（詞、片語、句子）的詞序列上比對句型（docs/pattern-query.md）。
 *
 * 流程：
 * 1. 剖析查詢（parser.ts）；構詞樣式依語言設定檔解析成詞素條件（morph.ts）。
 * 2. 每個詞的條件（atom）求成「詞形（搜尋鍵）→ 證據」：證據說明這個詞為什麼符合，形狀與一般搜尋例句的
 *    OccurrenceMatch 相同，介面直接用同一套說明標籤（HitTags）。
 * 3. 用每個正面條件必經的 atom 篩出候選記錄，逐筆在每一句、每一種讀法上比對（match.ts）。
 * 4. 分區（詞條、片語、句子，PATTERN_GROUPS）、排序、語詞索引（每個命中區間左右的詞）、頻率（每一格的詞形次數）。
 *
 * ## 各種詞的條件與一般搜尋的對應（兩邊用同一個函式）
 * - `kita`：依模糊程度的拼寫比對（SearchEngine._fuzzyTerms），即一般搜尋的完全相符與相近拼寫。
 * - `"kita"`：搜尋鍵完全相同。
 * - `pa…`、`…an`、`…ki…`：只看拼寫（… 是零個以上的字元）。
 * - `@kita`：一般搜尋 kita 的完全相符、相近拼寫、自動派生（_matchTerms）與確定派生（_dictionaryTokens）。
 * - 構詞樣式：拆解表（每個詞的所有 BCDP 拆法，即一般搜尋查這個詞時「自動拆解」列出的那一串，src/search/parses.ts），
 *   依模糊程度取拆法（morph.ts 的 PARSE_SELECTION），再比對詞素條件（morph.ts 的 satisfies）。
 *   寫出詞根（`pa-kita`）時另外要求拆法的詞根在 kita 的詞根集合中（與一般搜尋自動派生的起點相同，derivationSeeds）。
 *   詞根是 … 與寫出詞根用的是同一個條件，所以 `pa-…` 找到的詞，等於每個詞根 r 的 `pa-"r"` 合起來。
 */

import { EPSILON, FuzzyIndex, roundCost } from '#bcdp'
import { analyzeWord, DERIVATION_MAX_COST } from '../search/derivations.ts'
import type { SearchEngine } from '../search/engine.ts'
import { levelOf } from '../search/fuzziness.ts'
import type { DocSummary } from '../search/format.ts'
import { parsedAnalysis, sortParses, type ParsedAnalysis } from '../search/parses.ts'
import { alternativesOf, rankScore, recordScore, termScore, type MatchType } from '../search/scoring.ts'
import type { Fuzziness, MorphNote, OccurrenceMatch, SearchFilters } from '../search/types.ts'
import { requiredAtoms, type AtomNode, type PatternCondition, type PatternNode, type PatternQuery } from './ast.ts'
import { PatternError, type PatternIssue } from './errors.ts'
import { findMatches, matchesAnywhere } from './match.ts'
import { createPatternMorphology, PARSE_SELECTION, readingOfSteps, satisfies, selectParses, type MorphReading, type MorphRequirement, type PatternMorphology } from './morph.ts'
import { parsePattern } from './parser.ts'
import { segmentText, type SegmentedText } from './sentences.ts'

/**
 * 結果的分區（依記錄的語言單位）：詞條（詞綴與詞的條目）、片語、句子。各區各自排序、各自取前 limit 筆，
 * 句子再多也不會把詞條擠出回傳的範圍；介面依這個分區顯示（與一般搜尋的「詞條」「例句」相同的意思）。
 */
export const PATTERN_GROUPS = Object.freeze([
  Object.freeze({ key: 'entries', units: Object.freeze(['affix', 'word']) }),
  Object.freeze({ key: 'phrases', units: Object.freeze(['phrase']) }),
  Object.freeze({ key: 'sentences', units: Object.freeze(['sentence']) }),
] as const)
export type PatternGroupKey = 'entries' | 'phrases' | 'sentences'

/** 命中區間最多幾個（超過時停止並標記 truncated） */
export const MAX_MATCHES = 10000
/** 一次查詢最多花多少毫秒（超過時停止並標記 truncated） */
export const TIME_BUDGET_MS = 2000
/** 語詞索引每邊附上幾個詞（排序用） */
const CONTEXT_WORDS = 3
/** 頻率表每一格最多列幾種詞形 */
const FREQUENCY_ROWS = 100

/**
 * 一個詞為什麼符合：欄位與一般搜尋例句的 OccurrenceMatch 相同（介面用同一套標籤），另附排序用的分數。
 * word 是查詢中的寫法（構詞樣式是這個詞本身），term 是命中的詞庫詞或詞根，token 是句中的詞
 */
export type PatternEvidence = OccurrenceMatch & { score: number }

/** 依模糊程度取到的一種拆法；best 是同一種（詞庫詞根或虛擬詞根）拆法中最好的成本（介面說明「次佳」用） */
export type SelectedParse = ParsedAnalysis & { best: number; reading: MorphReading }

/** 命中區間中的一個詞 */
export interface PatternCell {
  /** 在原文中的位置（UTF-16，[start, end)） */
  start: number
  end: number
  /** 搜尋鍵 */
  key: string
  /** 屬於主條件的第幾格（頻率表用；其他條件為 null） */
  slot: number | null
  /** `_` 與 `!x` 比到的詞沒有說明 */
  evidence: PatternEvidence | null
}

/** 一個命中區間 */
export interface PatternMatch {
  /** 第幾個條件（0 是主條件） */
  cond: number
  /** 第一個詞在原文中的位置 */
  start: number
  /** 最後一個詞在原文中的結尾 */
  end: number
  /** 各詞分數的和（越小越前面） */
  score: number
  cells: PatternCell[]
  /** 區間左邊的詞（由近到遠，最多 CONTEXT_WORDS 個；語詞索引排序用） */
  left: string[]
  /** 區間右邊的詞（由近到遠） */
  right: string[]
}

export interface PatternHit {
  doc: DocSummary
  /** 各個正面條件最好的區間分數相加 */
  score: number
  /** 依條件、位置排列 */
  matches: PatternMatch[]
  /** 屬於哪一區（PATTERN_GROUPS，依記錄的語言單位） */
  group: PatternGroupKey
}

export interface PatternResponse {
  query: string
  mode: 'pattern'
  /** 查詢有錯時，其他欄位都是空的 */
  error: PatternIssue | null
  warnings: PatternIssue[]
  /** 依分區（詞條、片語、句子）排列，每區內依分數排序、最多 limit 筆 */
  hits: PatternHit[]
  /** 每一區的記錄數（三區都列出，沒有命中的是 0） */
  groups: Array<{ key: PatternGroupKey; total: number }>
  /** 主條件的各格（查詢中的寫法與位置；anchor：只是 ^ 或 $） */
  slots: Array<{ label: string; start: number; end: number; anchor: boolean }>
  /**
   * 主條件每一格（^ $ 除外）比到的詞形（同一格好幾個詞時以空白連接；比到零個詞時是空字串），以全部命中計算
   */
  frequency: Array<{ slot: number; total: number; distinct: number; rows: Array<{ form: string; count: number; docs: number }> }>
  totals: { hits: number; matches: number }
  stats: { elapsedMs: number; candidates: number; truncated: boolean }
}

export interface PatternSearchOptions {
  /** 預設 normal */
  fuzziness?: Fuzziness
  filters?: SearchFilters
  /** 每一區最多回傳幾筆記錄（預設 500） */
  limit?: number
  /** 為前幾筆記錄附上模糊命中的對齊說明（預設 40） */
  explainLimit?: number
  /** 先用必經的 atom 篩出候選記錄（只是加速，結果相同；測試時關掉來對照；預設 true） */
  prefilter?: boolean
}

/** 一個 atom → 「詞形 → 證據」；null 表示任一個詞（_） */
type Evidence = Map<AtomNode, Map<string, PatternEvidence> | null>

export class PatternSearch {
  readonly engine: SearchEngine
  private _corpus: { texts: SegmentedText[]; docsOf: Map<string, number[]> } | null = null
  private _morphology: PatternMorphology | null | undefined = undefined
  /** 模糊程度 → 詞 → 取到的拆法 */
  private _selected = new Map<string, Map<string, SelectedParse[]>>()
  /** (詞, 詞根) → 音變說明 */
  private _notes = new Map<string, MorphNote[]>()
  /** 詞庫外的詞 → 它的拆法（_unlistedParses） */
  private _unlisted = new Map<string, { all: ParsedAnalysis[]; floor: number }>()
  /** 語料中不在詞庫的詞的詞圖（unlistedIndex） */
  private _unlistedIndex: FuzzyIndex | null | undefined = undefined

  constructor(engine: SearchEngine) {
    this.engine = engine
  }

  /** 拆解表換了（engine.attachParseChart）：丟掉依拆解表算的快取 */
  reset(): void {
    this._selected = new Map()
    this._notes = new Map()
    this._unlisted = new Map()
    this._morphology = undefined
  }

  /** 所有記錄切成句與讀法（第一次用到時計算），以及「搜尋鍵 → 含有它的記錄」。 */
  get corpus(): { texts: SegmentedText[]; docsOf: Map<string, number[]> } {
    if (this._corpus) return this._corpus
    const { docs, text } = this.engine
    const texts: SegmentedText[] = []
    const docsOf = new Map<string, number[]>()
    for (let k = 0; k < docs.count; k++) {
      const seg = segmentText(docs.text[k], text.searchKey)
      texts.push(seg)
      for (const key of seg.keys) {
        const list = docsOf.get(key)
        if (list) list.push(k)
        else docsOf.set(key, [k])
      }
    }
    this._corpus = { texts, docsOf }
    return this._corpus
  }

  /**
   * 語料中不在詞庫的詞（例句體例展開的讀法，ma(ki)kiahan 的 makiahan）組成的小詞圖（第一次用到時建立）。
   * 不加引號的詞在詞庫的詞圖之外也查這裡，用同一個距離函式、同樣的門檻（TermMatcher.fuzzy 的選項），
   * 拼寫完全相同或相近的讀法才比得到。沒有這種詞時為 null。
   */
  get unlistedIndex(): FuzzyIndex | null {
    if (this._unlistedIndex === undefined) {
      const { index, metric } = this.engine
      const tokens = [...this.corpus.docsOf.keys()].filter((k) => index.dawg.lookup(k) === -1)
      if (tokens.length === 0) this._unlistedIndex = null
      else {
        const small = new FuzzyIndex(metric)
        small.addAll(tokens.map((t): [string, unknown] => [t, 0]))
        this._unlistedIndex = small
      }
    }
    return this._unlistedIndex
  }

  /** 構詞樣式的解析（語言設定檔沒有構詞規格時為 null） */
  get morphology(): PatternMorphology | null {
    if (this._morphology === undefined) {
      const { text, metric, index, derivations, parses } = this.engine
      /** 詞庫中的詞或虛擬詞根（構詞樣式判斷哪一段是詞根用） */
      const isRoot = (key: string) => index.dawg.lookup(key) !== -1 || Boolean(derivations?.virtualIds.has(key) || parses?.virtualIds.has(key))
      this._morphology = text.morphology ? createPatternMorphology(text.morphology.spec, text.searchKey, (a, b) => metric.distance(a, b), isRoot) : null
    }
    return this._morphology
  }

  /**
   * 一個構詞樣式（`pa-…`、`…-an`、`<in>…`）解析成詞素條件，與搜尋時的解析相同。
   * 檢查清單的人工拆解對照用（babizu/search 的 segmentation.ts）。寫法不是單一個構詞樣式、
   * 詞綴不在構詞規格中、或沒有構詞規格時回傳 null（不丟出錯誤）。
   */
  morphRequirement(query: string): MorphRequirement | null {
    const morphology = this.morphology
    if (!morphology) return null
    try {
      const parsed = parsePattern(query)
      const body = parsed.conditions.length === 1 ? parsed.conditions[0].body : null
      if (body?.type !== 'atom' || body.atom.kind !== 'morph') return null
      return morphology.resolve(body.atom.segments, [])
    } catch (err) {
      if (err instanceof PatternError) return null
      throw err
    }
  }

  /**
   * 一個詞（搜尋鍵）在這個模糊程度符不符合詞素條件：取到的拆法中第一個符合的，沒有就是 null。
   * 與搜尋比對構詞樣式是同一個判斷（_evaluate），所以檢查清單的對照與搜尋結果一致。需要拆解表。
   */
  matchMorph(key: string, req: MorphRequirement, fuzziness: Fuzziness): SelectedParse | null {
    return this._matchParse(key, req, this._rootsOf(req, fuzziness), fuzziness)
  }

  /** 詞依模糊程度取到的拆法（構詞樣式比對的就是這些；詞庫詞根的在前）。需要拆解表。 */
  parsesOf(key: string, fuzziness: Fuzziness): SelectedParse[] {
    return this._parsesOf(key, fuzziness)
  }

  search(query: string, { fuzziness = 'normal', filters = {}, limit = 500, explainLimit = 40, prefilter = true }: PatternSearchOptions = {}): PatternResponse {
    const started = now()
    const q = String(query ?? '').trim()
    const response: PatternResponse = {
      query: q,
      mode: 'pattern',
      error: null,
      warnings: [],
      hits: [],
      groups: PATTERN_GROUPS.map((g) => ({ key: g.key, total: 0 })),
      slots: [],
      frequency: [],
      totals: { hits: 0, matches: 0 },
      stats: { elapsedMs: 0, candidates: 0, truncated: false },
    }
    let compiled: ReturnType<PatternSearch['_compile']>
    try {
      const parsed = parsePattern(q)
      response.warnings.push(...parsed.warnings)
      compiled = this._compile(parsed, fuzziness, response.warnings, q)
    } catch (err) {
      if (!(err instanceof PatternError)) throw err
      response.error = err.toIssue()
      response.stats.elapsedMs = elapsed(started)
      return response
    }
    const { conditions, evidence, slotOf } = compiled
    const main = conditions[0].body
    const mainItems = main.type === 'seq' ? main.items : [main]
    response.slots = mainItems.map((n) => ({ label: q.slice(n.start, n.end), start: n.start, end: n.end, anchor: n.type === 'anchor' }))

    // 候選記錄：每個正面條件必經的 atom，都要有詞出現在記錄中
    const { texts, docsOf } = this.corpus
    const accept = this.engine.createFilter(filters)
    let candidates = null as Set<number> | null
    for (const c of prefilter ? conditions : []) {
      if (c.negated) continue
      for (const a of requiredAtoms(c.body)) {
        const map = evidence.get(a)
        if (!map) continue
        const docs = new Set<number>()
        for (const key of map.keys()) for (const k of docsOf.get(key) ?? []) docs.add(k)
        candidates = candidates ? new Set([...candidates].filter((k) => docs.has(k))) : docs
      }
    }
    const order = candidates ? [...candidates].sort((a, b) => a - b) : Array.from({ length: texts.length }, (_, k) => k)
    response.stats.candidates = order.length

    const evidenceOf = (node: AtomNode, key: string) => {
      const map = evidence.get(node)
      return map ? (map.get(key) ?? undefined) : null
    }
    const found: Array<{ k: number; score: number; matches: PatternMatch[] }> = []
    let matchCount = 0
    for (let n = 0; n < order.length; n++) {
      const k = order[n]
      if (!accept(k)) continue
      if (n % 256 === 0 && now() - started > TIME_BUDGET_MS) {
        response.stats.truncated = true
        break
      }
      const hit = this._matchRecord(texts[k], conditions, evidenceOf, slotOf)
      if (!hit) continue
      found.push({ k, ...hit })
      matchCount += hit.matches.filter((m) => m.cond === 0).length
      if (matchCount > MAX_MATCHES) {
        response.stats.truncated = true
        break
      }
    }
    found.sort((a, b) => a.score - b.score || a.k - b.k)
    response.totals = { hits: found.length, matches: matchCount }
    response.frequency = frequencyOf(
      found,
      response.slots.flatMap((s, k) => (s.anchor ? [] : [k])),
    )
    // 分區：各區依分數排序（found 已排好）、各取前 limit 筆
    const { docs } = this.engine
    /** 語言單位 → 分區 */
    const groupOfUnit = new Map<string, PatternGroupKey>(PATTERN_GROUPS.flatMap((g) => g.units.map((u): [string, PatternGroupKey] => [u, g.key])))
    const groupOf = (k: number) => groupOfUnit.get(docs.units[docs.unit[k]]) ?? 'sentences'
    response.groups = PATTERN_GROUPS.map((g) => ({ key: g.key, total: found.filter((f) => groupOf(f.k) === g.key).length }))
    response.hits = PATTERN_GROUPS.flatMap((g) =>
      found
        .filter((f) => groupOf(f.k) === g.key)
        .slice(0, limit)
        .map((f) => ({ doc: this.engine.doc(f.k), score: f.score, matches: f.matches, group: g.key })),
    )
    // 模糊命中的對齊說明、構詞樣式的音變說明只為前幾筆計算（同一個證據物件由所有用到它的詞共用，算一次就好）
    for (const hit of response.hits.slice(0, explainLimit)) {
      for (const m of hit.matches) {
        for (const c of m.cells) {
          const e = c.evidence
          if (e && e.matchType === 'fuzzy' && e.distance > 0 && e.alignment === null) e.alignment = this.engine.explainNotes(e.word, e.term)
          if (e && e.matchType === 'lemma' && e.analysis && e.analysis.notes === null) e.analysis.notes = this._notesOf(e.word, e.term)
        }
      }
    }
    response.stats.elapsedMs = elapsed(started)
    return response
  }

  /**
   * 剖析結果 → 每個 atom 的證據表、每個節點屬於主條件的第幾格。
   * @param query 整個查詢（提示中的改寫用）
   */
  private _compile(parsed: PatternQuery, fuzziness: Fuzziness, warnings: PatternIssue[], query: string): { conditions: PatternCondition[]; evidence: Evidence; slotOf: Map<object, number> } {
    const evidence: Evidence = new Map()
    let morphological = false
    for (const c of parsed.conditions) {
      for (const node of atomNodes(c.body)) {
        if (node.atom.kind === 'morph' || node.atom.kind === 'family') morphological = true
        evidence.set(node, this._evaluate(node, fuzziness, warnings, query))
      }
    }
    if (morphological && fuzziness === 'exact') warnings.push({ code: 'W_EXACT_MORPHOLOGY', start: 0, end: 0 })
    /** 主條件中每個節點屬於第幾格 */
    const slotOf = new Map<object, number>()
    const main = parsed.conditions[0].body
    const items = main.type === 'seq' ? main.items : [main]
    items.forEach((item, slot) => {
      for (const node of allNodes(item)) slotOf.set(node, slot)
    })
    return { conditions: parsed.conditions, evidence, slotOf }
  }

  /**
   * 一個 atom → 「詞形 → 證據」（只收語料中出現的詞形）；`_` 為 null。
   * @param query 整個查詢
   */
  private _evaluate(node: AtomNode, fuzziness: Fuzziness, warnings: PatternIssue[], query: string): Map<string, PatternEvidence> | null {
    const atom = node.atom
    if (atom.kind === 'any') return null
    const engine = this.engine
    const { docsOf } = this.corpus
    const out = new Map<string, PatternEvidence>()
    const put = (token: string, e: Omit<PatternEvidence, 'token' | 'kind' | 'alignment'> & { kind?: PatternEvidence['kind'] }) => {
      if (!docsOf.has(token)) return
      const prev = out.get(token)
      const next: PatternEvidence = { kind: 'token', alignment: null, ...e, token }
      if (!prev || next.score < prev.score - EPSILON) out.set(token, next)
    }
    const level = levelOf(fuzziness)
    const scratch = { visitedNodes: 0 }

    if (atom.kind === 'exact') {
      const key = keyOf(engine, atom.text, node)
      put(key, { word: key, term: key, matchType: 'fuzzy', distance: 0, analysis: null, score: 0 })
      return out
    }
    if (atom.kind === 'word') {
      const key = keyOf(engine, atom.text, node)
      for (const r of engine.terms.fuzzy(key, level, scratch).results) {
        put(r.term, { word: key, term: r.term, matchType: 'fuzzy', distance: r.distance, analysis: null, score: r.distance })
      }
      // 詞庫外的讀法：同樣的選項查它們的小詞圖
      const n = Array.from(key).length
      for (const r of this.unlistedIndex?.search(key, { maxDistance: level.maxDistance(n), normalization: 'max', maxNormalized: level.maxNormalized }) ?? []) {
        put(r.term, { word: key, term: r.term, matchType: 'fuzzy', distance: r.distance, analysis: null, score: r.distance })
      }
      return out
    }
    if (atom.kind === 'glob') {
      const parts = atom.parts.map((p) => engine.text.searchKey(p))
      const literal = parts.join('')
      if (!literal) throw new PatternError('E_EMPTY_WORD', node.start, node.end)
      const re = new RegExp(`^${parts.map(escapeRegExp).join('.*')}$`, 'u')
      const type = parts.length === 2 && parts[1] === '' ? 'prefix' : parts.length === 2 && parts[0] === '' ? 'suffix' : 'substring'
      for (const key of docsOf.keys()) {
        if (!re.test(key)) continue
        if (key === literal) put(key, { word: literal, term: key, matchType: 'fuzzy', distance: 0, analysis: null, score: 0 })
        else {
          const matchType: MatchType = type
          put(key, { word: literal, term: key, matchType, distance: 0, analysis: null, score: rankScore(matchType, 0, Array.from(key).length - Array.from(literal).length) })
        }
      }
      return out
    }
    if (atom.kind === 'family') {
      // 一般搜尋 kita 的完全相符、相近拼寫、自動派生（每個詞取第一個是這幾種的命中，與一般搜尋排除其他方法時相同）
      // 與確定派生（只從寫法就是 kita 的詞條展開，與一般搜尋相同）
      const key = keyOf(engine, atom.text, node)
      for (const t of engine.terms.match(key, level, scratch)) {
        const c = alternativesOf(t).find((x) => x.matchType === 'fuzzy' || x.matchType === 'derived')
        if (c) put(c.term, { word: key, term: c.term, matchType: c.matchType, distance: c.distance, analysis: c.analysis ?? null, score: recordScore(termScore(c, key)) })
        if (t.matchType !== 'fuzzy' || t.distance > 0) continue
        const score = termScore(t, key)
        for (const d of engine.relations.tokens(t)) {
          if (d.kind !== 'root') continue
          put(d.term, { word: key, term: t.term, kind: 'root', matchType: 'fuzzy', distance: 0, analysis: null, score: recordScore(score, d.depth) })
        }
      }
      return out
    }
    // 構詞樣式：每個詞依模糊程度取到的拆法中，第一個（成本最低的）符合詞素條件的
    const morphology = this.morphology
    if (!morphology) throw new PatternError('E_NO_MORPHOLOGY', node.start, node.end)
    if (!engine.parses) throw new Error('缺少拆解表（search/parses.json），請重新建置網站，或以 SearchEngine 的 parses 參數傳入')
    const req = morphology.resolve(atom.segments, warnings)
    const roots = this._rootsOf(req, fuzziness)
    for (const key of docsOf.keys()) {
      const parse = this._matchParse(key, req, roots, fuzziness)
      if (!parse) continue
      put(key, {
        word: key,
        term: parse.root,
        matchType: 'lemma',
        distance: parse.cost,
        analysis: {
          stem: parse.root,
          steps: parse.steps,
          cost: parse.cost,
          // 有音變時，說明只為前幾筆結果計算（search 的最後）
          notes: parse.sound > 0 ? null : [],
          bestCost: parse.best,
          ...(parse.virtual ? { virtual: true } : {}),
        },
        score: rankScore('lemma', parse.cost + (roots?.get(parse.root) ?? 0), 0),
      })
    }
    this._innerAffixHint(node, req, roots, fuzziness, out, warnings, query)
    return out
  }

  /**
   * 寫出的詞根 → 詞根集合（詞根 → 與查詢的距離）；詞根是 … 時為 null。
   * 與一般搜尋自動派生的起點相同（derivationSeeds：依模糊程度的相近拼寫）；寫在引號中時只有它本身。
   */
  private _rootsOf(req: MorphRequirement, fuzziness: Fuzziness): Map<string, number> | null {
    if (req.root === null) return null
    const roots = new Map<string, number>([[req.root, 0]])
    if (!req.rootExact) for (const seed of this.engine.terms.derivationSeeds(req.root, levelOf(fuzziness))) if (!roots.has(seed.term)) roots.set(seed.term, seed.distance)
    return roots
  }

  /**
   * 詞依模糊程度取到的拆法中，第一個（成本最低的）符合條件的；沒有就是 null。
   * @param key 詞（搜尋鍵）
   * @param roots 詞根集合（null：任意詞根）
   */
  private _matchParse(key: string, req: MorphRequirement, roots: Map<string, number> | null, fuzziness: Fuzziness): SelectedParse | null {
    for (const parse of this._parsesOf(key, fuzziness)) if ((roots === null || roots.has(parse.root)) && satisfies(req, parse.reading)) return parse
    return null
  }

  /**
   * 詞依模糊程度取到的拆法，附上詞素（依模糊程度、詞快取）。
   * 詞庫詞根的拆法在前（依成本），虛擬詞根的拆法在後：兩種都符合條件時，證據用詞庫詞根的拆法，
   * 與一般搜尋自動拆解列出的詞根相同（虛擬詞根的成本與 BCDP 的成本不能比，見 morph.ts 的 selectParses）。
   */
  private _parsesOf(key: string, fuzziness: Fuzziness): SelectedParse[] {
    const level = fuzziness in PARSE_SELECTION ? fuzziness : 'normal'
    let byWord = this._selected.get(level)
    if (!byWord) this._selected.set(level, (byWord = new Map()))
    let list = byWord.get(key)
    if (!list) {
      const engine = this.engine
      const id = engine.index.dawg.lookup(key)
      const chart = engine.parses as NonNullable<typeof engine.parses>
      // 詞庫中的詞查拆解表；不在詞庫中的（例句體例展開的讀法）現算，用建置時同一個函式
      const { all, floor } = id === -1 ? this._unlistedParses(key) : { all: chart.of(id), floor: chart.lexicalBestOf(id) }
      // 詞庫詞根的拆法從 BCDP 在詞庫中最好的命中算起（lexicalBestOf，可能不是拆法）；虛擬詞根的拆法另外全收
      const selected = selectParses(all, level, floor)
      /** 同一種拆法中最好的成本（介面說明「次佳」用） */
      const bestOfKind = (virtual: boolean) => Math.min(...all.filter((x) => x.virtual === virtual).map((x) => x.cost))
      list = [...selected.filter((x) => !x.virtual), ...selected.filter((x) => x.virtual)].map((x) => ({
        ...x,
        best: bestOfKind(x.virtual),
        reading: readingOfSteps(x.steps),
      }))
      byWord.set(key, list)
    }
    return list
  }

  /**
   * 不在詞庫中的詞的拆法：語料中的詞幾乎都在詞庫中，例外是例句體例展開的讀法
   * （ma(ki)kiahan 的 makiahan、makikiahan），建置時沒有算。查詢時用建置拆解表的同一個函式現算
   * （derivations.ts 的 analyzeWord，含虛擬詞根），結果與這個詞在詞庫中時拆解表的內容相同。
   * @returns 所有拆法（依成本排序）與 BCDP 在詞庫中最好的命中
   */
  private _unlistedParses(key: string): { all: ParsedAnalysis[]; floor: number } {
    let out = this._unlisted.get(key)
    if (!out) {
      const { morphSearch, index, text } = this.engine
      if (!morphSearch || !text.morphology) return { all: [], floor: Infinity }
      // 虛擬詞根的條件與建置時相同（詞庫中最好的詞根取自動派生圖這個詞的邊）；詞庫外的詞不會是別的詞的詞根
      const a = analyzeWord(key, index, morphSearch, false, this.engine.virtualRootSearch)
      const lexical = a.parses.map((p) => parsedAnalysis(index.terms[p.root], false, p.analysis.cost, p.analysis.steps, morphSearch.rootCost(index.terms[p.root])))
      const virtual = a.virtual.map((v) => parsedAnalysis(v.stem, true, roundCost(v.cost), v.steps))
      out = { all: sortParses([...lexical, ...virtual]), floor: Math.min(a.best ?? Infinity, ...lexical.map((p) => p.cost)) }
      this._unlisted.set(key, out)
    }
    return out
  }

  /**
   * 列出的前綴或後綴只算最外層；改成不錨定（外側加 …）能多找到詞形時提示，附上改寫後的整個查詢。
   * 改寫後的樣式照樣剖析、解析，數量用同一個比對算，所以點了提示得到的就是說的那些。
   * @param found 原本的樣式找到的詞
   */
  private _innerAffixHint(
    node: AtomNode,
    req: MorphRequirement,
    roots: Map<string, number> | null,
    fuzziness: Fuzziness,
    found: Map<string, PatternEvidence>,
    warnings: PatternIssue[],
    query: string,
  ): void {
    const openLeft = req.prefixes.length > 0 && !req.prefixesAnywhere
    const openRight = req.suffixes.length > 0 && !req.suffixesAnywhere
    if (!openLeft && !openRight) return
    const text = `${openLeft ? '…-' : ''}${query.slice(node.start, node.end)}${openRight ? '-…' : ''}`
    let wider: MorphRequirement
    try {
      const body = parsePattern(text).conditions[0].body
      if (body.type !== 'atom' || body.atom.kind !== 'morph') return
      wider = (this.morphology as PatternMorphology).resolve(body.atom.segments, [])
    } catch (err) {
      if (err instanceof PatternError) return
      throw err
    }
    let count = 0
    for (const key of this.corpus.docsOf.keys()) if (!found.has(key) && this._matchParse(key, wider, roots, fuzziness)) count++
    if (count === 0) return
    const form = [...(openLeft ? req.prefixes : []), ...(openRight ? req.suffixes : [])].map((g) => g.label).join(' ')
    warnings.push({
      code: 'W_INNER_AFFIX',
      start: node.start,
      end: node.end,
      params: { form, count, query: query.slice(0, node.start) + text + query.slice(node.end) },
    })
  }

  /** 構詞樣式命中的音變說明（與自動派生圖建置時同一個計算：BCDP 對這個詞、上限 DERIVATION_MAX_COST）。 */
  private _notesOf(word: string, root: string): MorphNote[] {
    const k = `${word}\u0000${root}`
    let notes = this._notes.get(k)
    if (!notes) {
      const { morphSearch: ms, index } = this.engine
      const prepared = ms ? ms.prepare(word, DERIVATION_MAX_COST) : null
      const hit = prepared ? ms?.finish(prepared, index.searchChannels(ms.seed(prepared).channels), DERIVATION_MAX_COST).find((h) => h.term === root) : null
      notes = prepared && hit && ms ? ms.notesOf(prepared, hit) : []
      this._notes.set(k, notes)
    }
    return notes
  }

  /**
   * 一筆記錄：每一句、每一種讀法分別比對。正面條件都要在某處比到、`& !` 的條件在任何讀法都不能比到。
   * @param evidenceOf undefined：不符合；null：符合但沒有說明（_）
   */
  private _matchRecord(
    text: SegmentedText,
    conditions: PatternCondition[],
    evidenceOf: (node: AtomNode, key: string) => PatternEvidence | null | undefined,
    slotOf: Map<object, number>,
  ): { score: number; matches: PatternMatch[] } | null {
    const matches: PatternMatch[] = []
    /** 同一個區間（不同讀法比到的）只留一次 */
    const seen = new Set<string>()
    for (const readings of text.segments) {
      for (const tokens of readings) {
        const test = (node: AtomNode, i: number) => evidenceOf(node, tokens[i].key) !== undefined
        for (let c = 0; c < conditions.length; c++) {
          const cond = conditions[c]
          if (cond.negated) {
            if (matchesAnywhere(cond.body, tokens.length, test)) return null
            continue
          }
          for (const span of findMatches(cond.body, tokens.length, test)) {
            const start = tokens[span.start].start
            const end = tokens[span.end - 1].end
            const id = `${c}:${start}:${end}`
            if (seen.has(id)) continue
            seen.add(id)
            const cells: PatternCell[] = span.cells.map(({ index, node }) => {
              const t = tokens[index]
              const evidence = node.type === 'atom' ? (evidenceOf(node, t.key) ?? null) : null
              return { start: t.start, end: t.end, key: t.key, slot: c === 0 ? (slotOf.get(node) ?? null) : null, evidence }
            })
            matches.push({
              cond: c,
              start,
              end,
              score: roundCost(cells.reduce((sum, x) => sum + (x.evidence?.score ?? 0), 0)),
              cells,
              left: tokens.slice(Math.max(0, span.start - CONTEXT_WORDS), span.start).map((t) => t.key).reverse(),
              right: tokens.slice(span.end, span.end + CONTEXT_WORDS).map((t) => t.key),
            })
          }
        }
      }
    }
    let score = 0
    for (let c = 0; c < conditions.length; c++) {
      if (conditions[c].negated) continue
      const own = matches.filter((m) => m.cond === c)
      if (own.length === 0) return null
      score += Math.min(...own.map((m) => m.score))
    }
    matches.sort((a, b) => a.cond - b.cond || a.start - b.start)
    return { score: roundCost(score), matches }
  }
}

/**
 * 主條件每一格的詞形次數。
 * @param slots 要統計的格（^ $ 不統計）
 */
function frequencyOf(found: Array<{ k: number; matches: PatternMatch[] }>, slots: number[]): PatternResponse['frequency'] {
  const tables: Array<Map<string, { count: number; docs: Set<number> }>> = slots.map(() => new Map())
  let total = 0
  for (const f of found) {
    for (const m of f.matches) {
      if (m.cond !== 0) continue
      total++
      slots.forEach((s, j) => {
        const form = m.cells
          .filter((c) => c.slot === s)
          .map((c) => c.key)
          .join(' ')
        const row = tables[j].get(form)
        if (row) {
          row.count++
          row.docs.add(f.k)
        } else tables[j].set(form, { count: 1, docs: new Set([f.k]) })
      })
    }
  }
  return tables.map((table, j) => ({
    slot: slots[j],
    total,
    distinct: table.size,
    rows: [...table]
      .map(([form, r]) => ({ form, count: r.count, docs: r.docs.size }))
      .sort((a, b) => b.count - a.count || b.docs - a.docs || (a.form < b.form ? -1 : a.form > b.form ? 1 : 0))
      .slice(0, FREQUENCY_ROWS),
  }))
}

/** 節點底下所有的 atom（含 ! 裡面的）。 */
function* atomNodes(node: PatternNode): Generator<AtomNode> {
  for (const n of allNodes(node)) if (n.type === 'atom') yield n
}

/** 節點與它底下的所有節點。 */
function* allNodes(node: PatternNode): Generator<PatternNode> {
  yield node
  switch (node.type) {
    case 'not':
    case 'repeat':
      yield* allNodes(node.node)
      return
    case 'seq':
      for (const x of node.items) yield* allNodes(x)
      return
    case 'alt':
      for (const x of node.options) yield* allNodes(x)
      return
  }
}

/** 查詢中的詞 → 搜尋鍵（沒有字母時是錯誤）。 */
function keyOf(engine: SearchEngine, text: string, at: { start: number; end: number }): string {
  const key = engine.text.searchKey(text)
  if (!key) throw new PatternError('E_EMPTY_WORD', at.start, at.end)
  return key
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const elapsed = (started: number) => Math.round((now() - started) * 10) / 10
