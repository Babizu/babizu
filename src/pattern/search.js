/**
 * @file 句型搜尋：在所有記錄（詞、片語、句子）的詞序列上比對句型（docs/pattern-query.md）。
 *
 * 流程：
 * 1. 剖析查詢（parser.js）；構詞樣式依語言設定檔解析成詞素條件（morph.js）。
 * 2. 每個詞的條件（atom）求成「詞形（搜尋鍵）→ 證據」：證據說明這個詞為什麼符合，形狀與一般搜尋例句的
 *    OccurrenceMatch 相同，介面直接用同一套說明標籤（HitTags）。
 * 3. 用每個正面條件必經的 atom 篩出候選記錄，逐筆在每一句、每一種讀法上比對（match.js）。
 * 4. 分區（詞條、片語、句子，PATTERN_GROUPS）、排序、語詞索引（每個命中區間左右的詞）、頻率（每一格的詞形次數）。
 *
 * ## 各種詞的條件與一般搜尋的對應（兩邊用同一個函式）
 * - `kita`：依模糊程度的拼寫比對（SearchEngine._fuzzyTerms），即一般搜尋的完全相符與相近拼寫。
 * - `"kita"`：搜尋鍵完全相同。
 * - `pa…`、`…an`、`…ki…`：只看拼寫（… 是零個以上的字元）。
 * - `@kita`：一般搜尋 kita 的完全相符、相近拼寫、自動派生（_matchTerms）與確定派生（_dictionaryTokens）。
 * - 構詞樣式：拆解表（每個詞的所有 BCDP 拆法，即一般搜尋查這個詞時「自動拆解」列出的那一串，src/search/parses.js），
 *   依模糊程度取拆法（morph.js 的 PARSE_SELECTION），再比對詞素條件（morph.js 的 satisfies）。
 *   寫出詞根（`pa-kita`）時另外要求拆法的詞根在 kita 的詞根集合中（與一般搜尋自動派生的起點相同，derivationSeeds）。
 *   詞根是 … 與寫出詞根用的是同一個條件，所以 `pa-…` 找到的詞，等於每個詞根 r 的 `pa-"r"` 合起來。
 */

import { requiredAtoms } from './ast.js'
import { PatternError } from './errors.js'
import { findMatches, matchesAnywhere } from './match.js'
import { createPatternMorphology, PARSE_SELECTION, readingOfSteps, satisfies, selectParses } from './morph.js'
import { parsePattern } from './parser.js'
import { segmentText } from './sentences.js'
import { FuzzyIndex, roundCost } from '../fuzzy/index.js'
import { analyzeWord, DERIVATION_MAX_COST } from '../search/derivations.js'
import { parsedAnalysis, sortParses } from '../search/parses.js'
import { alternativesOf, rankScore, recordScore, termScore } from '../search/scoring.js'

/**
 * 結果的分區（依記錄的語言單位）：詞條（詞綴與詞的條目）、片語、句子。各區各自排序、各自取前 limit 筆，
 * 句子再多也不會把詞條擠出回傳的範圍；介面依這個分區顯示（與一般搜尋的「詞條」「例句」相同的意思）。
 */
export const PATTERN_GROUPS = Object.freeze([
  Object.freeze({ key: 'entries', units: Object.freeze(['affix', 'word']) }),
  Object.freeze({ key: 'phrases', units: Object.freeze(['phrase']) }),
  Object.freeze({ key: 'sentences', units: Object.freeze(['sentence']) }),
])
/** @typedef {'entries' | 'phrases' | 'sentences'} PatternGroupKey */

/** 命中區間最多幾個（超過時停止並標記 truncated） */
export const MAX_MATCHES = 10000
/** 一次查詢最多花多少毫秒（超過時停止並標記 truncated） */
export const TIME_BUDGET_MS = 2000
/** 語詞索引每邊附上幾個詞（排序用） */
const CONTEXT_WORDS = 3
/** 頻率表每一格最多列幾種詞形 */
const FREQUENCY_ROWS = 100
const EPSILON = 1e-9

/**
 * @typedef {import('../search/engine.js').OccurrenceMatch & {score: number}} PatternEvidence
 *   一個詞為什麼符合：欄位與一般搜尋例句的 OccurrenceMatch 相同（介面用同一套標籤），另附排序用的分數。
 *   word 是查詢中的寫法（構詞樣式是這個詞本身），term 是命中的詞庫詞或詞根，token 是句中的詞
 */

/**
 * @typedef {import('../search/parses.js').ParsedAnalysis & {best: number, reading: import('./morph.js').MorphReading}} SelectedParse
 *   依模糊程度取到的一種拆法；best 是同一種（詞庫詞根或虛擬詞根）拆法中最好的成本（介面說明「次佳」用）
 */

/**
 * @typedef {object} PatternCell 命中區間中的一個詞
 * @property {number} start 在原文中的位置（UTF-16，[start, end)）
 * @property {number} end
 * @property {string} key 搜尋鍵
 * @property {number | null} slot 屬於主條件的第幾格（頻率表用；其他條件為 null）
 * @property {PatternEvidence | null} evidence `_` 與 `!x` 比到的詞沒有說明
 */

/**
 * @typedef {object} PatternMatch 一個命中區間
 * @property {number} cond 第幾個條件（0 是主條件）
 * @property {number} start 第一個詞在原文中的位置
 * @property {number} end 最後一個詞在原文中的結尾
 * @property {number} score 各詞分數的和（越小越前面）
 * @property {PatternCell[]} cells
 * @property {string[]} left 區間左邊的詞（由近到遠，最多 CONTEXT_WORDS 個；語詞索引排序用）
 * @property {string[]} right 區間右邊的詞（由近到遠）
 */

/**
 * @typedef {object} PatternHit
 * @property {import('../search/format.js').DocSummary} doc
 * @property {number} score 各個正面條件最好的區間分數相加
 * @property {PatternMatch[]} matches 依條件、位置排列
 * @property {PatternGroupKey} group 屬於哪一區（PATTERN_GROUPS，依記錄的語言單位）
 */

/**
 * @typedef {object} PatternResponse
 * @property {string} query
 * @property {'pattern'} mode
 * @property {import('./errors.js').PatternIssue | null} error 查詢有錯時，其他欄位都是空的
 * @property {import('./errors.js').PatternIssue[]} warnings
 * @property {PatternHit[]} hits 依分區（詞條、片語、句子）排列，每區內依分數排序、最多 limit 筆
 * @property {Array<{key: PatternGroupKey, total: number}>} groups 每一區的記錄數（三區都列出，沒有命中的是 0）
 * @property {Array<{label: string, start: number, end: number, anchor: boolean}>} slots 主條件的各格（查詢中的寫法與位置；anchor：只是 ^ 或 $）
 * @property {Array<{slot: number, total: number, distinct: number, rows: Array<{form: string, count: number, docs: number}>}>} frequency
 *   主條件每一格（^ $ 除外）比到的詞形（同一格好幾個詞時以空白連接；比到零個詞時是空字串），以全部命中計算
 * @property {{hits: number, matches: number}} totals
 * @property {{elapsedMs: number, candidates: number, truncated: boolean}} stats
 */

/**
 * @typedef {object} PatternSearchOptions
 * @property {import('../search/engine.js').Fuzziness} [fuzziness='normal']
 * @property {import('../search/engine.js').SearchFilters} [filters]
 * @property {number} [limit=500] 每一區最多回傳幾筆記錄
 * @property {number} [explainLimit=40] 為前幾筆記錄附上模糊命中的對齊說明
 * @property {boolean} [prefilter=true] 先用必經的 atom 篩出候選記錄（只是加速，結果相同；測試時關掉來對照）
 */

export class PatternSearch {
  /** @param {import('../search/engine.js').SearchEngine} engine */
  constructor(engine) {
    this.engine = engine
    /** @type {{texts: import('./sentences.js').SegmentedText[], docsOf: Map<string, number[]>} | null} */
    this._corpus = null
    /** @type {ReturnType<typeof createPatternMorphology> | null | undefined} */
    this._morphology = undefined
    /** @type {Map<string, Map<string, SelectedParse[]>>} 模糊程度 → 詞 → 取到的拆法 */
    this._selected = new Map()
    /** @type {Map<string, import('../search/engine.js').MorphNote[]>} (詞, 詞根) → 音變說明 */
    this._notes = new Map()
    /** @type {Map<string, {all: import('../search/parses.js').ParsedAnalysis[], floor: number}>} 詞庫外的詞 → 它的拆法（_unlistedParses） */
    this._unlisted = new Map()
    /** @type {FuzzyIndex | null | undefined} 語料中不在詞庫的詞的詞圖（unlistedIndex） */
    this._unlistedIndex = undefined
  }

  /** 拆解表換了（engine.attachParseChart）：丟掉依拆解表算的快取 */
  reset() {
    this._selected = new Map()
    this._notes = new Map()
    this._unlisted = new Map()
    this._morphology = undefined
  }

  /**
   * 所有記錄切成句與讀法（第一次用到時計算），以及「搜尋鍵 → 含有它的記錄」。
   */
  get corpus() {
    if (this._corpus) return this._corpus
    const { docs, text } = this.engine
    /** @type {import('./sentences.js').SegmentedText[]} */
    const texts = []
    /** @type {Map<string, number[]>} */
    const docsOf = new Map()
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
   * 不加引號的詞在詞庫的詞圖之外也查這裡，用同一個距離函式、同樣的門檻（SearchEngine._fuzzyTerms 的選項），
   * 拼寫完全相同或相近的讀法才比得到。沒有這種詞時為 null。
   */
  get unlistedIndex() {
    if (this._unlistedIndex === undefined) {
      const { index, metric } = this.engine
      const tokens = [...this.corpus.docsOf.keys()].filter((k) => index.dawg.lookup(k) === -1)
      if (tokens.length === 0) this._unlistedIndex = null
      else {
        const small = new FuzzyIndex(metric)
        small.addAll(tokens.map((t) => [t, 0]))
        this._unlistedIndex = small
      }
    }
    return this._unlistedIndex
  }

  /** 構詞樣式的解析（語言設定檔沒有構詞規格時為 null） */
  get morphology() {
    if (this._morphology === undefined) {
      const { text, metric, index, derivations, parses } = this.engine
      /** 詞庫中的詞或虛擬詞根（構詞樣式判斷哪一段是詞根用） @param {string} key */
      const isRoot = (key) => index.dawg.lookup(key) !== -1 || Boolean(derivations?.virtualIds.has(key) || parses?.virtualIds.has(key))
      this._morphology = text.morphology ? createPatternMorphology(text.morphology.spec, text.searchKey, (a, b) => metric.distance(a, b), isRoot) : null
    }
    return this._morphology
  }

  /**
   * @param {string} query
   * @param {PatternSearchOptions} [options]
   * @returns {PatternResponse}
   */
  search(query, { fuzziness = 'normal', filters = {}, limit = 500, explainLimit = 40, prefilter = true } = {}) {
    const started = now()
    const q = String(query ?? '').trim()
    /** @type {PatternResponse} */
    const response = {
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
    /** @type {ReturnType<PatternSearch['_compile']>} */
    let compiled
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
    const accept = this.engine._createFilter(filters)
    /** @type {Set<number> | null} */
    let candidates = null
    for (const c of prefilter ? conditions : []) {
      if (c.negated) continue
      for (const a of requiredAtoms(c.body)) {
        const map = evidence.get(a)
        if (!map) continue
        /** @type {Set<number>} */
        const docs = new Set()
        for (const key of map.keys()) for (const k of docsOf.get(key) ?? []) docs.add(k)
        candidates = candidates ? new Set([...candidates].filter((k) => docs.has(k))) : docs
      }
    }
    const order = candidates ? [...candidates].sort((a, b) => a - b) : Array.from({ length: texts.length }, (_, k) => k)
    response.stats.candidates = order.length

    /** @param {import('./match.js').AtomNode} node @param {string} key */
    const evidenceOf = (node, key) => {
      const map = evidence.get(node)
      return map ? (map.get(key) ?? undefined) : null
    }
    /** @type {Array<{k: number, score: number, matches: PatternMatch[]}>} */
    const found = []
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
    /** @type {Map<string, PatternGroupKey>} 語言單位 → 分區 */
    const groupOfUnit = new Map(PATTERN_GROUPS.flatMap((g) => g.units.map((u) => [u, g.key])))
    /** @param {number} k */
    const groupOf = (k) => groupOfUnit.get(docs.units[docs.unit[k]]) ?? 'sentences'
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
   * @param {import('./ast.js').PatternQuery} parsed
   * @param {import('../search/engine.js').Fuzziness} fuzziness
   * @param {import('./errors.js').PatternIssue[]} warnings
   * @param {string} query 整個查詢（提示中的改寫用）
   */
  _compile(parsed, fuzziness, warnings, query) {
    /** @type {Map<import('./match.js').AtomNode, Map<string, PatternEvidence> | null>} null 表示任一個詞（_） */
    const evidence = new Map()
    let morphological = false
    for (const c of parsed.conditions) {
      for (const node of atomNodes(c.body)) {
        if (node.atom.kind === 'morph' || node.atom.kind === 'family') morphological = true
        evidence.set(node, this._evaluate(node, fuzziness, warnings, query))
      }
    }
    if (morphological && fuzziness === 'exact') warnings.push({ code: 'W_EXACT_MORPHOLOGY', start: 0, end: 0 })
    /** @type {Map<object, number>} 主條件中每個節點屬於第幾格 */
    const slotOf = new Map()
    const main = parsed.conditions[0].body
    const items = main.type === 'seq' ? main.items : [main]
    items.forEach((item, slot) => {
      for (const node of allNodes(item)) slotOf.set(node, slot)
    })
    return { conditions: parsed.conditions, evidence, slotOf }
  }

  /**
   * 一個 atom → 「詞形 → 證據」（只收語料中出現的詞形）；`_` 為 null。
   * @param {import('./match.js').AtomNode} node
   * @param {import('../search/engine.js').Fuzziness} fuzziness
   * @param {import('./errors.js').PatternIssue[]} warnings
   * @param {string} query 整個查詢
   * @returns {Map<string, PatternEvidence> | null}
   */
  _evaluate(node, fuzziness, warnings, query) {
    const atom = node.atom
    if (atom.kind === 'any') return null
    const engine = this.engine
    const { docsOf } = this.corpus
    /** @type {Map<string, PatternEvidence>} */
    const out = new Map()
    /** @param {string} token @param {Omit<PatternEvidence, 'token' | 'kind' | 'alignment'> & {kind?: PatternEvidence['kind']}} e */
    const put = (token, e) => {
      if (!docsOf.has(token)) return
      const prev = out.get(token)
      const next = /** @type {PatternEvidence} */ ({ kind: 'token', alignment: null, ...e, token })
      if (!prev || next.score < prev.score - EPSILON) out.set(token, next)
    }
    const level = engine._level(fuzziness)
    const scratch = /** @type {import('../search/engine.js').SearchResponse} */ (/** @type {unknown} */ ({ stats: { visitedNodes: 0 } }))

    if (atom.kind === 'exact') {
      const key = keyOf(engine, atom.text, node)
      put(key, { word: key, term: key, matchType: 'fuzzy', distance: 0, analysis: null, score: 0 })
      return out
    }
    if (atom.kind === 'word') {
      const key = keyOf(engine, atom.text, node)
      for (const r of engine._fuzzyTerms(key, level, scratch).results) {
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
          const matchType = /** @type {import('../search/scoring.js').MatchType} */ (type)
          put(key, { word: literal, term: key, matchType, distance: 0, analysis: null, score: rankScore(matchType, 0, Array.from(key).length - Array.from(literal).length) })
        }
      }
      return out
    }
    if (atom.kind === 'family') {
      // 一般搜尋 kita 的完全相符、相近拼寫、自動派生（每個詞取第一個是這幾種的命中，與一般搜尋排除其他方法時相同）
      // 與確定派生（只從寫法就是 kita 的詞條展開，與一般搜尋相同）
      const key = keyOf(engine, atom.text, node)
      for (const t of engine._matchTerms(key, level, scratch, true)) {
        const c = alternativesOf(t).find((x) => x.matchType === 'fuzzy' || x.matchType === 'derived')
        if (c) put(c.term, { word: key, term: c.term, matchType: c.matchType, distance: c.distance, analysis: c.analysis ?? null, score: recordScore(termScore(c, key)) })
        if (t.matchType !== 'fuzzy' || t.distance > 0) continue
        const score = termScore(t, key)
        for (const d of engine._dictionaryTokens(t)) {
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
   * @param {import('./morph.js').MorphRequirement} req
   * @param {import('../search/engine.js').Fuzziness} fuzziness
   * @returns {Map<string, number> | null}
   */
  _rootsOf(req, fuzziness) {
    if (req.root === null) return null
    /** @type {Map<string, number>} */
    const roots = new Map([[req.root, 0]])
    if (!req.rootExact) for (const seed of this.engine.derivationSeeds(req.root, fuzziness)) if (!roots.has(seed.term)) roots.set(seed.term, seed.distance)
    return roots
  }

  /**
   * 詞依模糊程度取到的拆法中，第一個（成本最低的）符合條件的；沒有就是 null。
   * @param {string} key 詞（搜尋鍵）
   * @param {import('./morph.js').MorphRequirement} req
   * @param {Map<string, number> | null} roots 詞根集合（null：任意詞根）
   * @param {import('../search/engine.js').Fuzziness} fuzziness
   */
  _matchParse(key, req, roots, fuzziness) {
    for (const parse of this._parsesOf(key, fuzziness)) if ((roots === null || roots.has(parse.root)) && satisfies(req, parse.reading)) return parse
    return null
  }

  /**
   * 詞依模糊程度取到的拆法，附上詞素（依模糊程度、詞快取）。
   * 詞庫詞根的拆法在前（依成本），虛擬詞根的拆法在後：兩種都符合條件時，證據用詞庫詞根的拆法，
   * 與一般搜尋自動拆解列出的詞根相同（虛擬詞根的成本與 BCDP 的成本不能比，見 morph.js 的 selectParses）。
   * @param {string} key
   * @param {import('../search/engine.js').Fuzziness} fuzziness
   * @returns {SelectedParse[]}
   */
  _parsesOf(key, fuzziness) {
    const level = fuzziness in PARSE_SELECTION ? fuzziness : 'normal'
    let byWord = this._selected.get(level)
    if (!byWord) this._selected.set(level, (byWord = new Map()))
    let list = byWord.get(key)
    if (!list) {
      const engine = this.engine
      const id = engine.index.dawg.lookup(key)
      const chart = /** @type {NonNullable<typeof engine.parses>} */ (engine.parses)
      // 詞庫中的詞查拆解表；不在詞庫中的（例句體例展開的讀法）現算，用建置時同一個函式
      const { all, floor } = id === -1 ? this._unlistedParses(key) : { all: chart.of(id), floor: chart.lexicalBestOf(id) }
      // 詞庫詞根的拆法從 BCDP 在詞庫中最好的命中算起（lexicalBestOf，可能不是拆法）；虛擬詞根的拆法另外全收
      const selected = selectParses(all, level, floor)
      /** 同一種拆法中最好的成本（介面說明「次佳」用） @param {boolean} virtual */
      const bestOfKind = (virtual) => Math.min(...all.filter((x) => x.virtual === virtual).map((x) => x.cost))
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
   * （derivations.js 的 analyzeWord，含虛擬詞根），結果與這個詞在詞庫中時拆解表的內容相同。
   * @param {string} key
   * @returns {{all: import('../search/parses.js').ParsedAnalysis[], floor: number}} 所有拆法（依成本排序）與 BCDP 在詞庫中最好的命中
   */
  _unlistedParses(key) {
    let out = this._unlisted.get(key)
    if (!out) {
      const { morphSearch, index, text } = this.engine
      if (!morphSearch || !text.morphology) return { all: [], floor: Infinity }
      // 虛擬詞根的條件與建置時相同（詞庫中最好的詞根取自動派生圖這個詞的邊）；詞庫外的詞不會是別的詞的詞根
      const a = analyzeWord(key, index, morphSearch, false, this.engine.virtualRootSearch)
      const lexical = a.parses.map((p) => parsedAnalysis(index.terms[p.root], false, p.analysis.cost, p.analysis.steps))
      const virtual = a.virtual.map((v) => parsedAnalysis(v.stem, true, roundCost(v.cost), v.steps))
      out = { all: sortParses([...lexical, ...virtual]), floor: Math.min(a.best ?? Infinity, ...lexical.map((p) => p.cost)) }
      this._unlisted.set(key, out)
    }
    return out
  }

  /**
   * 列出的前綴或後綴只算最外層；改成不錨定（外側加 …）能多找到詞形時提示，附上改寫後的整個查詢。
   * 改寫後的樣式照樣剖析、解析，數量用同一個比對算，所以點了提示得到的就是說的那些。
   * @param {import('./match.js').AtomNode} node
   * @param {import('./morph.js').MorphRequirement} req
   * @param {Map<string, number> | null} roots
   * @param {import('../search/engine.js').Fuzziness} fuzziness
   * @param {Map<string, PatternEvidence>} found 原本的樣式找到的詞
   * @param {import('./errors.js').PatternIssue[]} warnings
   * @param {string} query
   */
  _innerAffixHint(node, req, roots, fuzziness, found, warnings, query) {
    const openLeft = req.prefixes.length > 0 && !req.prefixesAnywhere
    const openRight = req.suffixes.length > 0 && !req.suffixesAnywhere
    if (!openLeft && !openRight) return
    const text = `${openLeft ? '…-' : ''}${query.slice(node.start, node.end)}${openRight ? '-…' : ''}`
    /** @type {import('./morph.js').MorphRequirement} */
    let wider
    try {
      const body = parsePattern(text).conditions[0].body
      if (body.type !== 'atom' || body.atom.kind !== 'morph') return
      wider = /** @type {NonNullable<typeof this.morphology>} */ (this.morphology).resolve(body.atom.segments, [])
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

  /**
   * 構詞樣式命中的音變說明（與自動派生圖建置時同一個計算：BCDP 對這個詞、上限 DERIVATION_MAX_COST）。
   * @param {string} word
   * @param {string} root
   */
  _notesOf(word, root) {
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
   * @param {import('./sentences.js').SegmentedText} text
   * @param {import('./ast.js').PatternCondition[]} conditions
   * @param {(node: import('./match.js').AtomNode, key: string) => PatternEvidence | null | undefined} evidenceOf
   *   undefined：不符合；null：符合但沒有說明（_）
   * @param {Map<object, number>} slotOf
   * @returns {{score: number, matches: PatternMatch[]} | null}
   */
  _matchRecord(text, conditions, evidenceOf, slotOf) {
    /** @type {PatternMatch[]} */
    const matches = []
    /** @type {Set<string>} 同一個區間（不同讀法比到的）只留一次 */
    const seen = new Set()
    for (const readings of text.segments) {
      for (const tokens of readings) {
        /** @param {import('./match.js').AtomNode} node @param {number} i */
        const test = (node, i) => evidenceOf(node, tokens[i].key) !== undefined
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
            /** @type {PatternCell[]} */
            const cells = span.cells.map(({ index, node }) => {
              const t = tokens[index]
              const evidence = node.type === 'atom' ? (evidenceOf(node, t.key) ?? null) : null
              return { start: t.start, end: t.end, key: t.key, slot: c === 0 ? (slotOf.get(node) ?? null) : null, evidence }
            })
            matches.push({
              cond: c,
              start,
              end,
              score: round(cells.reduce((sum, x) => sum + (x.evidence?.score ?? 0), 0)),
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
    return { score: round(score), matches }
  }
}

/**
 * 主條件每一格的詞形次數。
 * @param {Array<{k: number, matches: PatternMatch[]}>} found
 * @param {number[]} slots 要統計的格（^ $ 不統計）
 * @returns {PatternResponse['frequency']}
 */
function frequencyOf(found, slots) {
  /** @type {Array<Map<string, {count: number, docs: Set<number>}>>} */
  const tables = slots.map(() => new Map())
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

/**
 * 節點底下所有的 atom（含 ! 裡面的）。
 * @param {import('./ast.js').PatternNode} node
 * @returns {Generator<import('./match.js').AtomNode>}
 */
function* atomNodes(node) {
  for (const n of allNodes(node)) if (n.type === 'atom') yield n
}

/**
 * 節點與它底下的所有節點。
 * @param {import('./ast.js').PatternNode} node
 * @returns {Generator<import('./ast.js').PatternNode>}
 */
function* allNodes(node) {
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

/**
 * 查詢中的詞 → 搜尋鍵（沒有字母時是錯誤）。
 * @param {import('../search/engine.js').SearchEngine} engine
 * @param {string} text
 * @param {{start: number, end: number}} at
 */
function keyOf(engine, text, at) {
  const key = engine.text.searchKey(text)
  if (!key) throw new PatternError('E_EMPTY_WORD', at.start, at.end)
  return key
}

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
/** @param {number} x */
const round = (x) => Math.round(x * 1e9) / 1e9
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
/** @param {number} started */
const elapsed = (started) => Math.round((now() - started) * 10) / 10
