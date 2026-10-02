/**
 * @file 句型搜尋：在所有記錄（詞、片語、句子）的詞序列上比對句型（docs/pattern-query.md）。
 *
 * 流程：
 * 1. 剖析查詢（parser.js）；構詞樣式依語言設定檔解析成詞素條件（morph.js）。
 * 2. 每個詞的條件（atom）求成「詞形（搜尋鍵）→ 證據」：證據說明這個詞為什麼符合，形狀與一般搜尋例句的
 *    OccurrenceMatch 相同，介面直接用同一套說明標籤（HitTags）。
 * 3. 用每個正面條件必經的 atom 篩出候選記錄，逐筆在每一句、每一種讀法上比對（match.js）。
 * 4. 排序、語詞索引（每個命中區間左右的詞）、頻率（每一格的詞形次數）。
 *
 * ## 各種詞的條件與一般搜尋的對應（兩邊用同一個函式）
 * - `kita`：依模糊程度的拼寫比對（SearchEngine._fuzzyTerms），即一般搜尋的完全相符與相近拼寫。
 * - `"kita"`：搜尋鍵完全相同。
 * - `pa…`、`…an`、`…ki…`：只看拼寫（… 是零個以上的字元）。
 * - `@kita`：一般搜尋 kita 的完全相符、相近拼寫、自動派生（_matchTerms）與確定派生（_dictionaryTokens）。
 * - 構詞樣式：自動派生圖（BCDP 為每個詞求得的最好詞根）。寫出詞根（`pa-kita`）時由詞根往下（reachFrom），
 *   詞根是 … 時由詞往上（ancestors）；兩個方向取的是同一條路徑（derivations.js），所以結果一致。
 *   路徑成本的上限與一般搜尋相同：依詞根的長度與模糊程度（SearchEngine._lemmaMax）。
 */

import { requiredAtoms } from './ast.js'
import { PatternError } from './errors.js'
import { findMatches, matchesAnywhere } from './match.js'
import { createPatternMorphology, readingOfPath, satisfies } from './morph.js'
import { parsePattern } from './parser.js'
import { segmentText } from './sentences.js'
import { alternativesOf, rankScore, recordScore, termScore } from '../search/scoring.js'

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
 *   word 是查詢中的寫法（構詞樣式詞根是 … 時是這個詞本身），term 是命中的詞庫詞或詞根，token 是句中的詞
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
 */

/**
 * @typedef {object} PatternResponse
 * @property {string} query
 * @property {'pattern'} mode
 * @property {import('./errors.js').PatternIssue | null} error 查詢有錯時，其他欄位都是空的
 * @property {import('./errors.js').PatternIssue[]} warnings
 * @property {PatternHit[]} hits 依分數排序（最多 limit 筆）
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
 * @property {number} [limit=500] 最多回傳幾筆記錄
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
    /** @type {Map<number, Array<{root: number, reach: import('../search/derivations.js').DerivedReach, reading: import('./morph.js').MorphReading}>>} 詞 → 往上的各個詞根與詞素 */
    this._ancestors = new Map()
    /** @type {WeakMap<object, import('./morph.js').MorphReading>} 路徑 → 詞素 */
    this._readings = new WeakMap()
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

  /** 構詞樣式的解析（語言設定檔沒有構詞規格時為 null） */
  get morphology() {
    if (this._morphology === undefined) {
      const { text, metric, index, derivations } = this.engine
      /** 詞庫中的詞或虛擬詞根（構詞樣式判斷哪一段是詞根用） @param {string} key */
      const isRoot = (key) => index.dawg.lookup(key) !== -1 || Boolean(derivations?.virtualIds.has(key))
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
      compiled = this._compile(parsed, fuzziness, response.warnings)
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
    response.hits = found.slice(0, limit).map((f) => ({ doc: this.engine.doc(f.k), score: f.score, matches: f.matches }))
    // 模糊命中的對齊說明只為前幾筆計算（同一個證據物件由所有用到它的詞共用，算一次就好）
    for (const hit of response.hits.slice(0, explainLimit)) {
      for (const m of hit.matches) {
        for (const c of m.cells) {
          const e = c.evidence
          if (e && e.matchType === 'fuzzy' && e.distance > 0 && e.alignment === null) e.alignment = this.engine.explainNotes(e.word, e.term)
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
   */
  _compile(parsed, fuzziness, warnings) {
    /** @type {Map<import('./match.js').AtomNode, Map<string, PatternEvidence> | null>} null 表示任一個詞（_） */
    const evidence = new Map()
    let morphological = false
    for (const c of parsed.conditions) {
      for (const node of atomNodes(c.body)) {
        if (node.atom.kind === 'morph' || node.atom.kind === 'family') morphological = true
        evidence.set(node, this._evaluate(node, fuzziness, warnings))
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
   * @returns {Map<string, PatternEvidence> | null}
   */
  _evaluate(node, fuzziness, warnings) {
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
    // 構詞樣式
    const morphology = this.morphology
    const graph = engine.derivations
    if (!morphology || !graph) throw new PatternError('E_NO_MORPHOLOGY', node.start, node.end)
    const req = morphology.resolve(atom.segments, warnings)
    const nodes = graph.nodes
    if (req.root !== null) {
      // 寫出詞根：由詞根（與它依模糊程度的相近寫法）往下走，與一般搜尋的自動派生相同
      const root = req.root
      const seeds = req.rootExact ? lookupSeed(engine, root) : engine.derivationSeeds(root, fuzziness)
      const virtual = graph.virtualIds.get(root)
      if (virtual !== undefined) seeds.push({ id: virtual, distance: 0, term: root })
      /** @type {Map<string, import('../search/engine.js').AlignmentNote[]>} */
      const variantNotes = new Map()
      for (const seed of seeds) {
        const limit = engine._lemmaMax(nodes[seed.id], level)
        for (const [word, reach] of graph.reachFrom(seed.id)) {
          if (reach.cost > limit + EPSILON || !satisfies(req, this._readingOf(reach))) continue
          const cost = Math.round((seed.distance + reach.cost) * 1e9) / 1e9
          const term = engine.index.terms[word]
          put(term, {
            word: root,
            term,
            matchType: 'derived',
            distance: cost,
            analysis: engine._reachAnalysis(root, reach, seed, cost, variantNotes),
            score: rankScore('derived', cost, 0),
          })
        }
      }
      return out
    }
    // 詞根是 …：每個詞往上找它的詞根（同一條路徑，見 derivations.js 的 ancestors）
    for (const key of docsOf.keys()) {
      const id = engine.index.dawg.lookup(key)
      if (id === -1) continue
      for (const a of this._ancestorsOf(id)) {
        if (a.reach.cost > engine._lemmaMax(nodes[a.root], level) + EPSILON || !satisfies(req, a.reading)) continue
        const cost = a.reach.cost
        put(key, {
          word: key,
          term: nodes[a.root],
          matchType: 'lemma',
          distance: cost,
          analysis: engine._reachAnalysis(key, a.reach, { term: nodes[a.root], distance: 0 }, cost),
          score: rankScore('lemma', cost, 0),
        })
        break
      }
    }
    return out
  }

  /** @param {import('../search/derivations.js').DerivedReach} reach */
  _readingOf(reach) {
    let r = this._readings.get(reach)
    if (!r) this._readings.set(reach, (r = readingOfPath(reach.path)))
    return r
  }

  /** 詞往上的各個詞根，附上詞素（依路徑成本排序） @param {number} id */
  _ancestorsOf(id) {
    let list = this._ancestors.get(id)
    if (!list) {
      const graph = /** @type {NonNullable<import('../search/engine.js').SearchEngine['derivations']>} */ (this.engine.derivations)
      list = graph.ancestors(id).map((a) => ({ ...a, reading: this._readingOf(a.reach) }))
      this._ancestors.set(id, list)
    }
    return list
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

/**
 * 詞根寫在引號中：只用這個拼寫當起點。
 * @param {import('../search/engine.js').SearchEngine} engine
 * @param {string} key
 * @returns {Array<{id: number, distance: number, term: string}>}
 */
function lookupSeed(engine, key) {
  const id = engine.index.dawg.lookup(key)
  return id === -1 ? [] : [{ id, distance: 0, term: key }]
}

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
/** @param {number} x */
const round = (x) => Math.round(x * 1e9) / 1e9
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
/** @param {number} started */
const elapsed = (started) => Math.round((now() - started) * 10) / 10
