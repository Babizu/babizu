/**
 * @file 構詞文法的第二種實作：類 pika 的加權剖析器（docs/morph-grammar.md 5.2）。
 *
 * 與 BCDP（編譯後的 morph-search.js）算的是**同一個**成本（docs/morph-grammar.md 2.6）：
 *   步驟成本 ＋ 未收錄組合的懲罰 ＋ 不成立條件的懲罰 ＋ 查詢對整個底層字串的加權編輯距離（交界語意見 bcdp.md 1.3）。
 * 但做法完全獨立，所以兩者可以互相仲裁：
 *
 * | | BCDP | 這裡 |
 * |---|---|---|
 * | 構詞規格 | 編譯後的平面清單（compile.js） | 文法本身；複合形式、條件、表面是否對得上都由推導產生器 derive.js 決定 |
 * | 不同的分析 | 在交界上取 min 合併（bcdp.md 定理 2），條件依類別分開（定理 3） | 從不合併：每個前綴那側的分析與每個走訪結果逐一組合 |
 * | 詞根走訪 | 由合併後的交界狀態（整個向量）出發，一次 | 由單一個格子出發，每個起點一次，給所有走到那一格的分析共用 |
 * | 對齊 | fillRow、CompiledRules、交界狀態、跨界表 | 逐格照定義計算（與 test/fuzzy/reference/ref-joint.js 相同的轉移） |
 * | 條件 | 沿詞綴與詞圖讀的 DFA | 分析完成時，以 derive 在具體的字串上判斷 |
 *
 * ## 項目與備忘（pika 的對應）
 * pika 剖析器以（子句, 位置）為索引，每個項目只算一次，由下而上組合。這裡的子句是「詞根 · 後綴那側」，
 * 位置是詞根走訪的起點：
 * - **前綴那側**：列舉前綴單位序列（至多 maxSteps 個）與最內層的組合規則，逐欄算到詞根開頭的交界。
 *   每一種分析 π 在交界欄上得到向量 D_π。
 * - **詞根走訪**（項目）：由單一個格子 (a, 交界) 出發、成本 0，沿詞庫詞圖走詞根、接後綴那側，
 *   得到（詞根, 後綴單位, 對齊成本）的清單。從單一格子出發時，交界之前的欄只透過那一格影響之後，
 *   所以這個結果與「是哪一個 π 走到那一格」無關，可以給所有 π 共用。
 *   跨越前綴｜詞根交界的規則另有自己的走訪：由規則之後的那一格出發，詞根開頭已被規則的 target 涵蓋。
 * - **組合**：總成本 ＝ D_π(a)（或跨界規則之前的格子 ＋ 權重）＋ 走訪結果 ＋ 步驟成本 ＋ 懲罰，
 *   對每個 π、每個走訪結果逐一計算，取每個詞根的最小值。
 * 正確性：整個詞的最佳對齊路徑在前綴｜詞根交界欄上一定經過某一格，或被一條規則跨過（至多跨一個交界），
 * 所以把路徑在那裡切開，兩段各自最佳，就是整條的最佳（詳見文件）。
 *
 * 與計畫中「Knuth 議程＋交界脈絡」的差異：議程要把不同分析的成本合併成項目（那正是 BCDP 的定理 2），
 * 仲裁就不獨立了；這裡的項目只以「單一格子」為起點，不需要議程，也不需要交界脈絡（跨界規則直接列舉）。
 *
 * ## 一欄怎麼算
 * D(a, b)＝把查詢 x[0..a) 轉成 u[0..b) 的最小成本（u 是底層字串）。第 b 欄只由第 b − L … b − 1 欄
 * （L＝最長的規則 target）與同一欄較小的 a 算出。第 b 欄的值還取決於走到那裡之前不知道的事，所以欄在「知道之後」才算：
 * - 位置 b 是不是交界（J）：決定詞首、詞尾規則與構詞音變能不能在這裡適用；
 * - u[b] 是不是詞尾或空白（F）：非交界時，詞尾規則要求 u 在這裡結束；
 * - 詞幹的範圍 [s0, s1] 與固定的交界（還原變體）：空白只能在詞幹內消耗、固定的交界不能被跨越。
 * 所以每一欄有三種版本：N（之後是普通字元）、F（之後是詞尾或空白）、J（交界）。要走下一個字元時，
 * 依那個字元選版本「定案」（commit），之後的欄只讀已定案的版本。
 *
 * ## 剪枝
 * - 下界（lowerBound）：之後的格子只能由這一欄，或由較早的欄經一條「還沒走完」的規則走到。加上已經確定的步驟成本
 *   超過上限就不再往下走。條件的懲罰在分析完成時才加（≥ 0，不影響下界）。
 * - 上限收緊：找到命中之後，上限是「目前最佳 ＋ lemmaSpread」（最後只保留這個範圍內的詞根）。
 *
 * ## 可停止性（docs/morph-grammar.md 第 4 節）
 * 前綴、後綴單位序列的長度 ≤ maxSteps，單位的數目有限（文法有限、每個同位詞素非空）；詞庫詞圖無環；
 * 走訪的起點有 O(n × 跨界規則數) 個；還原變體有 O(n² × 運算數) 個。每一層都是有限的迴圈，沒有遞迴呼叫「符號」
 * 的地方：左遞迴 Word → Prefix · Word 在這裡是「前綴序列再加一個單位」，深度有上限。
 */

import { EDGE_JUNCTION, EDGE_WORD } from '../dp.js'
import { derive, reduplicant } from './derive.js'
import { constructionShape } from './spec.js'

/** @typedef {import('./spec.js').Grammar} Grammar */
/** @typedef {import('./derive.js').Op} Op */

const EPS = 1e-9
const round = (/** @type {number} */ x) => Math.round(x * 1e9) / 1e9
/** 私用區的字元：推導產生器的探測詞根用（不是元音，不會出現在詞綴裡） */
const PROBE = '\uE000'

/**
 * @typedef {object} Part
 * @property {string} id
 * @property {string} type
 * @property {string} form 同位詞素的形式（重疊是型式）
 * @property {any} gloss
 */

/**
 * @typedef {object} Unit 前綴那側或後綴那側的一個單位：一個自由的詞素，或落在前綴上的中綴（複合前綴）
 * @property {string[]} chars 底層字串
 * @property {Op[]} ops 推導順序
 * @property {number} cost 步驟成本（複合前綴含 unattestedPenalty）
 * @property {Part[]} parts
 * @property {boolean} unattested
 */

/**
 * @typedef {object} ConstructionUnit 一條組合規則的一種同位詞素選擇
 * @property {'prefix' | 'stem'} shape
 * @property {string[]} left 前綴那側的材料（shape 為 prefix）
 * @property {{kind: 'infix' | 'reduplication', form: string, pattern: any} | null} stemOp 詞根上的運算（shape 為 stem）
 * @property {string[]} right 後綴那側的材料（可以是空的）
 * @property {Op[]} ops
 * @property {number} cost
 * @property {{id: string, gloss: any}} construction
 * @property {Part[]} parts
 */

/**
 * @typedef {object} StemOp 自由的詞根上的中綴、重疊（一個同位詞素）
 * @property {'infix' | 'reduplication'} kind
 * @property {string} form
 * @property {any} pattern
 * @property {Op[]} ops
 * @property {number} cost
 * @property {Part[]} parts
 */

/**
 * @typedef {object} Variant 還原變體：詞根上的中綴、重疊在查詢上拿掉，詞根的起點、結尾固定在查詢的位置上
 * @property {number} i 詞根在還原後的查詢上的起點
 * @property {boolean} junctionStart 詞根開頭一定是交界（重疊部分｜詞根）
 * @property {Set<number>} ends 詞根可以在哪些查詢位置結束
 * @property {StemOp | null} stemOp
 * @property {ConstructionUnit | null} cons 詞根上的運算屬於組合規則時
 * @property {string | null} red 重疊部分（說明用）
 * @property {number} cost 運算（或組合規則）的步驟成本
 */

/**
 * @typedef {object} ChartHit
 * @property {string} term
 * @property {unknown[]} payloads
 * @property {number} distance 總成本
 * @property {Array<Record<string, any>>} steps 由外而內（與 BCDP 的 MorphStepHit 相同的格式）
 * @property {number} [penalty] 不成立的條件的懲罰
 * @property {Array<{id: string, form: string, when: string, penalty: number}>} [violations]
 * @property {ChartTrace} trace 重建對齊用（說明中的音變）：metric.explainSegments(query, segments, options)
 *   的對齊成本加上步驟成本與懲罰就是 distance
 */

/**
 * @typedef {object} ChartTrace
 * @property {string[]} query 查詢（還原變體是還原後的查詢）
 * @property {Array<{chars: string[], lock: boolean, type: 'prefix' | 'stem' | 'suffix'}>} segments 各詞素依詞中的順序
 * @property {{startEdge?: number, pinStart?: {segment: number, x: number}, pinEnd?: {segment: number, allowed: Set<number>}}} options
 */

/**
 * @typedef {object} ChartStats 工作量（可停止性測試以它為準，不以時間）
 * @property {number} visitedNodes 詞圖節點的造訪數
 * @property {number} columns 算過的 DP 欄數
 * @property {number} [walks] 詞根走訪數
 * @property {number} [crossBest] 最後的命中中，最佳分析來自跨界規則的走訪的個數（測試的 reaching check 用）
 */

/**
 * 建立類 pika 的構詞搜尋。
 * @param {object} deps
 * @param {Grammar} deps.grammar 正規化後的文法（spec.js 的 normalizeGrammar；analyzer.grammar）
 * @param {import('../distance.js').WeightedEditDistance} deps.metric 距離函式（只取規則表、成本表與邊界字元）
 * @param {import('../fuzzy-index.js').FuzzyIndex} deps.index 詞庫
 */
export function createChartSearch({ grammar: g, metric, index }) {
  const vowels = new Set(Array.from(g.vowels))
  const isVowel = (/** @type {string} */ c) => vowels.has(c)
  const isB = (/** @type {string | undefined} */ ch) => ch !== undefined && metric.boundaries.has(ch)
  const costs = metric.costs

  // ── 規則表：直接由 RuleSet 展開（不用 CompiledRules） ──
  const rules = metric.ruleSet.expand(metric.normalize).map((r) => ({
    source: Array.from(r.source),
    target: Array.from(r.target),
    weight: r.weight,
    position: r.position,
    junction: Boolean(r.junction),
  }))
  const L = Math.max(1, ...rules.map((r) => r.target.length))
  /** 可以跨越詞素交界的規則：沒有位置限制的方言規則，target 至少兩個字元（bcdp.md 1.3 第 3 項） */
  const crossRules = rules.filter((r) => r.position === 'any' && !r.junction && r.target.length >= 2)
  /** target 為空的規則（只動查詢）：每一欄都要看 */
  const xOnly = rules.filter((r) => r.target.length === 0)
  /** @type {Map<string, typeof rules>} 其他規則依 target 的最後一個字元分組 */
  const byLast = new Map()
  for (const r of rules) {
    if (r.target.length === 0) continue
    const k = r.target[r.target.length - 1]
    let list = byLast.get(k)
    if (!list) byLast.set(k, (list = []))
    list.push(r)
  }
  /**
   * 還沒走完的規則：target 的每個真前綴 → 以它開頭的規則中最小的權重。剪枝的下界用它（見 lowerBound）：
   * 較早的欄只有在某條規則的 target 可以由那裡跨過目前的位置時，才可能影響之後的格子。
   * @type {Map<string, number>}
   */
  const pending = new Map()
  for (const r of rules) {
    for (let k = 1; k < r.target.length; k++) {
      const head = r.target.slice(0, k).join('')
      pending.set(head, Math.min(pending.get(head) ?? Infinity, r.weight))
    }
  }
  /** 交界上增生的字元（只動查詢、不限詞尾的規則）：重疊部分與詞幹之間可以略過（bcdp.md 1.6） */
  const junctionInserts = [...new Set(xOnly.filter((r) => r.position !== 'final').map((r) => r.source.join('')))].map((s) => Array.from(s))

  // ── 由文法產生各種單位（複合形式由推導產生器決定，與 compile.js 無關） ──
  const vowel = g.vowels[0] ?? 'a'
  /**
   * 以探測詞根（元音開頭）推導，取出詞根兩側的材料。詞根的字元被拆開（中綴落在詞根裡）時回傳 null。
   * 只有輔音的前綴插入中綴時，形式只在詞根以元音開頭時成立（2.7 第 1 項）；那個限制在分析完成時由 derive 檢查。
   * @param {Op[]} ops
   */
  const sides = (ops) => {
    const root = [vowel, PROBE, vowel]
    const d = derive(g, root.join(''), ops)
    if (!d.valid) return null
    const at = d.chars.flatMap((c, k) => (c.owner === -1 ? [k] : []))
    if (at.length !== root.length || at[at.length - 1] - at[0] !== root.length - 1) return null
    return { left: d.chars.slice(0, at[0]).map((c) => c.ch), right: d.chars.slice(at[at.length - 1] + 1).map((c) => c.ch) }
  }
  /** @param {import('./spec.js').Morpheme} m @param {number} k @returns {Part} */
  const partOf = (m, k) => ({ id: m.id, type: m.type, form: m.type === 'reduplication' ? /** @type {string} */ (m.allomorphs[k].pattern) : m.allomorphs[k].form, gloss: m.gloss })

  /** @type {Unit[]} */
  const prefixUnits = []
  /** @type {Unit[]} */
  const suffixUnits = []
  /** @type {StemOp[]} */
  const stemOps = []
  for (const m of g.morphemes) {
    if (!m.free) continue
    m.allomorphs.forEach((a, k) => {
      const ops = [{ id: m.id, allomorph: k }]
      if (m.type === 'prefix') prefixUnits.push({ chars: Array.from(a.form), ops, cost: m.cost, parts: [partOf(m, k)], unattested: false })
      else if (m.type === 'suffix') suffixUnits.push({ chars: Array.from(a.form), ops, cost: m.cost, parts: [partOf(m, k)], unattested: false })
      else stemOps.push({ kind: m.type === 'infix' ? 'infix' : 'reduplication', form: a.form, pattern: a.pattern, ops, cost: m.cost, parts: [partOf(m, k)] })
    })
  }
  // 落在前綴上的中綴（順序敏感、沒有組合規則）：前綴之後立刻插入中綴，成本加 unattestedPenalty。
  // 平面清單寫法的規格沒有這種組合（舊版的語意：中綴只加在詞根上）
  for (const p of g.source === 'legacy' ? [] : g.morphemes) {
    if (!p.free || p.type !== 'prefix') continue
    for (const x of g.morphemes) {
      if (!x.free || x.type !== 'infix') continue
      p.allomorphs.forEach((_, pk) => {
        x.allomorphs.forEach((__, xk) => {
          const ops = [
            { id: p.id, allomorph: pk },
            { id: x.id, allomorph: xk },
          ]
          const s = sides(ops)
          if (!s || s.right.length) return
          prefixUnits.push({ chars: s.left, ops, cost: p.cost + x.cost + g.unattestedPenalty, parts: [partOf(p, pk), partOf(x, xk)], unattested: true })
        })
      })
    }
  }
  /** @type {ConstructionUnit[]} */
  const constructions = []
  for (const c of g.constructions) {
    const members = c.sequence.map((id) => /** @type {import('./spec.js').Morpheme} */ (g.byId.get(id)))
    const shape = constructionShape(members.map((m) => m.type)).kind
    /** @param {number} k @param {number[]} choice */
    const walk = (k, choice) => {
      if (k < members.length) {
        for (let a = 0; a < members[k].allomorphs.length; a++) walk(k + 1, [...choice, a])
        return
      }
      const ops = members.map((m, j) => ({ id: m.id, allomorph: choice[j] }))
      const parts = members.map((m, j) => partOf(m, choice[j]))
      const base = { ops, cost: c.cost, construction: { id: c.id, gloss: c.gloss }, parts }
      if (shape === 'stem') {
        const first = members[0].allomorphs[choice[0]]
        const right = members.slice(1).flatMap((m, j) => Array.from(m.allomorphs[choice[j + 1]].form))
        const kind = /** @type {'infix' | 'reduplication'} */ (members[0].type)
        constructions.push({ shape: 'stem', left: [], stemOp: { kind, form: first.form, pattern: first.pattern }, right, ...base })
      } else {
        const s = sides(ops)
        if (s) constructions.push({ shape: 'prefix', left: s.left, stemOp: null, right: s.right, ...base })
      }
    }
    walk(0, [])
  }
  const prefixConstructions = constructions.filter((c) => c.shape === 'prefix')

  /**
   * 分析完成時，以推導產生器在具體的字串上檢查：表面是否就是各單位接起來的樣子（複合前綴、組合規則的形式
   * 對這個詞根是否成立），以及每個同位詞素的條件是否成立。
   *
   * 詞根上的中綴、重疊不在底層字串裡（查詢端還原），它的模板是否適用由還原變體決定（與 BCDP 相同），
   * 所以這裡的「詞根」是推導產生器對詞根套用那一個運算的結果 core：表面必須是「前綴單位 · 左邊 · core · 右邊 ·
   * 後綴單位」。之後的運算若改動了 core（例如只有輔音的前綴插入中綴時，中綴落進了重疊部分），分析不成立。
   * @param {string} term
   * @param {Unit[]} pre 詞中的順序（由外而內）
   * @param {ConstructionUnit | null} cons
   * @param {StemOp | null} stemOp
   * @param {Unit[]} suf 詞中的順序（由內而外）
   */
  const check = (term, pre, cons, stemOp, suf) => {
    /** @type {Op[]} 推導順序：組合規則（或詞根上的運算）最先，前綴由內而外，後綴由內而外 */
    const ops = [...(cons ? cons.ops : stemOp ? stemOp.ops : []), ...[...pre].reverse().flatMap((u) => u.ops), ...suf.flatMap((u) => u.ops)]
    const d = derive(g, term, ops)
    const stemLevel = cons?.shape === 'stem' || stemOp !== null
    const core = stemLevel ? derive(g, term, [ops[0]]).surface : term
    const want = [...pre.flatMap((u) => u.chars), ...(cons?.left ?? []), core, ...(cons?.right ?? []), ...suf.flatMap((u) => u.chars)].join('')
    if (d.surface !== want) return null
    let penalty = 0
    /** @type {Array<{id: string, form: string, when: string, penalty: number}>} */
    const violations = []
    ops.forEach((op, k) => {
      if (d.satisfied[k]) return
      const m = /** @type {import('./spec.js').Morpheme} */ (g.byId.get(op.id))
      const a = m.allomorphs[op.allomorph ?? 0]
      penalty += g.conditionPenalty
      violations.push({ id: m.id, form: m.type === 'reduplication' ? /** @type {string} */ (a.pattern) : a.form, when: /** @type {any} */ (a.condition).source, penalty: g.conditionPenalty })
    })
    return { penalty, violations }
  }

  /**
   * 一條路徑上的 DP 表（查詢 x 固定；底層字串 u 隨走訪增減）。
   * @param {string[]} x
   * @param {ChartStats | undefined} stats
   * @param {{a: number, b: number}} [origin] 成本 0 的起點格子：前綴那側由 (0, 0) 開始；詞根走訪由查詢的一個位置開始
   */
  const makePath = (x, stats, origin = { a: 0, b: 0 }) => {
    const n = x.length
    /** @type {string[]} */
    const u = []
    /** @type {Float64Array[]} 已定案的欄 */
    const cols = []
    /** @type {boolean[]} 已定案的欄是否為交界 */
    const J = []
    /** @type {number[]} 已定案的欄的最小值 */
    const mins = []
    /** 空白的前綴和：x 前 a 個字元中的空白數 */
    const spaces = [0]
    for (let a = 0; a < n; a++) spaces.push(spaces[a] + (isB(x[a]) ? 1 : 0))
    /** 每條規則的 source 是否以查詢的位置 a 結尾 */
    const srcAt = new Map(
      rules.map((r) => {
        const ok = new Uint8Array(n + 1)
        for (let a = r.source.length; a <= n; a++) {
          let same = 1
          for (let k = 0; k < r.source.length; k++) if (x[a - r.source.length + k] !== r.source[k]) same = 0
          ok[a] = same
        }
        return [r, ok]
      }),
    )
    const path = {
      /** 詞幹的範圍 [s0, s1]：還沒開始是 −1，還沒結束是 ∞ */
      s0: -1,
      s1: Infinity,
      /** @type {Array<{b: number, allowed: Set<number>}>} 固定的交界 */
      pins: [],
      /**
       * 剪枝只看查詢位置 ≤ cap 的格子：還原變體的前綴那側必須正好在詞根的起點 i 結束，而查詢的位置沿路徑只增不減，
       * 所以位置已經超過 i 的格子不可能再走到 (i, 詞根開頭)。其他時候是 n（不限）。
       */
      cap: n,
      get length() {
        return u.length
      },
      u,
      /** 已定案的第 b 欄 @param {number} b */
      col: (b) => cols[b],
      /** 規則的 source 是否以查詢的位置 a 結尾 @param {typeof rules[number]} r @param {number} a */
      sourceEndsAt: (r, a) => /** @type {Uint8Array} */ (srcAt.get(r))[a] === 1,
      /** x[a0..a) 含空白 @param {number} a0 @param {number} a */
      spends: (a0, a) => spaces[a] - spaces[a0] > 0,
      /**
       * 算第 b ＝ u.length 欄的某個版本（不定案）。轉移與 ref-joint.js 的 cell 相同。
       * @param {'N' | 'F' | 'J'} mode
       */
      column(mode) {
        if (stats) stats.columns++
        const b = u.length
        const { s0, s1, pins } = path
        const isJ = (/** @type {number} */ c) => (c === b ? mode === 'J' : J[c])
        const spends = (/** @type {number} */ a0, /** @type {number} */ a) => spaces[a] - spaces[a0] > 0
        /** 範圍 (b0, b) 內嚴格包含的交界數 */
        const inside = (/** @type {number} */ b0) => {
          let k = 0
          for (let c = b0 + 1; c < b; c++) if (J[c]) k++
          return k
        }
        /** 一個操作是否合法：固定的交界不能被跨越；空白只能在詞幹內消耗（交界上只動查詢的操作不能消耗空白） */
        const legal = (/** @type {number} */ a0, /** @type {number} */ a, /** @type {number} */ b0) => {
          for (const pin of pins) if (b0 < pin.b && pin.b < b) return false
          if (!spends(a0, a)) return true
          if (s0 < 0) return false
          if (b0 === b) return b >= s0 && b <= s1 && !isJ(b)
          return b0 >= s0 && b <= s1
        }
        // 這一欄可能用到的規則：只動查詢的，以及 target 正好是 u 的結尾的
        const colRules = [...xOnly]
        if (b > 0) {
          for (const r of byLast.get(u[b - 1]) ?? []) {
            const b0 = b - r.target.length
            if (b0 < 0) continue
            let tail = true
            for (let k = 0; k < r.target.length; k++) if (u[b0 + k] !== r.target[k]) tail = false
            if (tail) colRules.push(r)
          }
        }
        const uInitial = (/** @type {number} */ b0) => b0 === 0 || isB(u[b0 - 1])
        const xInitial = (/** @type {number} */ a) => a === 0 || isB(x[a - 1])
        const xFinal = (/** @type {number} */ a) => a === n || isB(x[a])
        const cur = new Float64Array(n + 1).fill(Infinity)
        const prev = b > 0 ? cols[b - 1] : null
        /** @param {number} a @param {boolean} onlyX 只考慮同一欄、只動查詢的轉移 */
        const cell = (a, onlyX) => {
          let best = !onlyX && a === origin.a && b === origin.b ? 0 : Infinity
          if (a > 0 && legal(a - 1, a, b)) best = Math.min(best, cur[a - 1] + costs.del(x[a - 1]))
          if (!onlyX && prev && legal(a, a, b - 1)) best = Math.min(best, prev[a] + costs.ins(u[b - 1]))
          if (!onlyX && prev && a > 0 && legal(a - 1, a, b - 1)) best = Math.min(best, prev[a - 1] + costs.sub(x[a - 1], u[b - 1]))
          for (const r of colRules) {
            if (onlyX && r.target.length > 0) continue
            if (!(/** @type {Uint8Array} */ (srcAt.get(r))[a])) continue
            const a0 = a - r.source.length
            const b0 = b - r.target.length
            if (!legal(a0, a, b0)) continue
            const crossing = inside(b0)
            if (crossing > 1 || (crossing === 1 && (r.position !== 'any' || r.junction))) continue
            if (r.junction) {
              if (r.position === 'initial' && !isJ(b0)) continue
              if (r.position === 'final' && !isJ(b)) continue
              if (r.position === 'any' && !isJ(b0) && !isJ(b)) continue
            } else {
              if (r.position === 'initial' && !(isJ(b0) || (uInitial(b0) && xInitial(a0)))) continue
              if (r.position === 'final' && !(isJ(b) || (mode === 'F' && xFinal(a)))) continue
            }
            const from = b0 === b ? cur[a0] : cols[b0][a0]
            if (from + r.weight < best) best = from + r.weight
          }
          // 交界欄上，查詢的位置不能在空白旁
          if (isJ(b) && ((a > 0 && isB(x[a - 1])) || (a < n && isB(x[a])))) best = Infinity
          return best
        }
        for (let a = 0; a <= n; a++) cur[a] = cell(a, false)
        // 固定的交界：這一欄只留允許的格子，再由它們沿同一欄做只動查詢的操作
        for (const pin of pins) {
          if (pin.b !== b) continue
          for (let a = 0; a <= n; a++) {
            const kept = pin.allowed.has(a) ? cur[a] : Infinity
            cur[a] = kept
            cur[a] = Math.min(kept, cell(a, true))
          }
        }
        return cur
      },
      /** 定案第 u.length 欄 @param {Float64Array} col @param {boolean} junction */
      commit(col, junction) {
        cols[u.length] = col
        J[u.length] = junction
        let m = Infinity
        for (const v of col) if (v < m) m = v
        mins[u.length] = m
      },
      /** 加一個字元（它之前的那一欄必須已經定案） @param {string} ch */
      push(ch) {
        u.push(ch)
      },
      /** 截回到 len 個字元（第 len 欄回到未定案） @param {number} len */
      cut(len) {
        u.length = len
        cols.length = len
        J.length = len
        mins.length = len
      },
      /**
       * 之後所有格子的下界。任何走到之後的路徑，離開「第 b 欄以前」的那一步只有兩種：由第 b 欄（尚未定案的 col）出發，
       * 或是一條規則由第 b − k 欄出發、target 的前 k 個字元就是 u[b − k..b)、還沒走完（k < |target|）。
       * 之後的成本都 ≥ 0，所以下界是 min(col) 與這些「還沒走完的規則」的 min(第 b − k 欄) ＋ 權重。
       * @param {Float64Array} col
       */
      lowerBound(col) {
        const cap = path.cap
        let lb = Infinity
        for (let a = 0; a <= cap; a++) if (col[a] < lb) lb = col[a]
        const b = u.length
        let head = ''
        for (let k = 1; k < L && k <= b; k++) {
          head = u[b - k] + head
          const w = pending.get(head)
          if (w === undefined) continue
          let m = mins[b - k]
          if (cap < n) {
            m = Infinity
            for (let a = 0; a <= cap; a++) if (cols[b - k][a] < m) m = cols[b - k][a]
          }
          if (m + w < lb) lb = m + w
        }
        return lb
      },
    }
    return path
  }

  /** 之後的字元決定非交界欄的版本 @param {string} ch @returns {'N' | 'F'} */
  const modeBefore = (ch) => (isB(ch) ? 'F' : 'N')

  /**
   * @typedef {object} User 用同一次詞根走訪的一個前綴那側分析
   * @property {Unit[]} pre 前綴單位（詞中的順序）
   * @property {ConstructionUnit | null} cons 最內層的組合規則（前綴式）
   * @property {number} spent 前綴那側的步驟成本（含組合規則、還原變體的運算）
   * @property {number} base spent ＋ 走到走訪起點的對齊成本
   */

  /**
   * @typedef {object} Walk 一次詞根走訪（pika 的備忘項目）：由查詢的一個位置出發的「詞根 · 後綴那側」
   * @property {'origin' | 'junction' | 'cross'} kind origin：詞首（沒有前綴）；junction：交界上的一格；
   *   cross：一條跨越前綴｜詞根交界的規則之後（它的 target 已經涵蓋詞根開頭的 head）
   * @property {number} a 起點的查詢位置
   * @property {string[]} head 跨界規則已經涵蓋的詞根開頭（cross 才有）
   * @property {string[]} right 詞根之後一定要接的組合規則右邊
   * @property {User[]} users
   */

  /**
   * 構詞搜尋。
   *
   * 第 3 節（docs/morph-grammar.md 5.2）的三個階段，每個查詢變體（原查詢、各還原變體）各做一次：
   * 1. **前綴那側**：列舉前綴單位序列（與最內層的組合規則），逐欄算到詞根開頭的交界，得到每一種分析在交界欄上的
   *    向量 D_π。分析 π 登記到它需要的詞根走訪上：交界欄的每一格 a 一次（成本 D_π(a)），以及每條跨越交界的規則一次。
   * 2. **詞根走訪**：每個走訪由單一個格子出發（成本 0），沿詞圖走詞根、接後綴那側，收集完成的
   *    （詞根, 後綴單位, 對齊成本）。走訪只依賴起點，不依賴是哪一個 π 走到那裡——從單一格子出發時，
   *    之前的欄只透過那一格影響之後（跨界的規則另有自己的走訪），所以同一個走訪可以給所有 π 共用。
   *    這就是 pika 的備忘：（子句＝詞根 · 後綴那側, 位置＝起點）只算一次。
   * 3. **組合**：每個完成的走訪結果與登記在那裡的每個 π 相加，再以推導產生器檢查表面與條件。
   *    不同的 π 從不合併（BCDP 的定理 2 在這裡沒有用到），所以兩種實作互相獨立。
   *
   * 正確性：整條底層字串上的最佳對齊路徑，在前綴｜詞根交界欄上一定經過某一格 (a, J)，或被一條規則跨過；
   * 前者等於 D_π(a) ＋ 由 (a, J) 出發的最佳走訪，後者等於跨界規則之前的格子 ＋ 權重 ＋ 由規則之後出發的最佳走訪。
   * 取兩者的最小值就是整個詞的最佳對齊（與逐條路徑的 DP 相同；隨機測試與窮舉仲裁）。
   * @param {string} query 已正規化的查詢（搜尋鍵）
   * @param {{maxDistance: number, stats?: ChartStats}} options
   * @returns {ChartHit[]} 依成本、詞排序，已套用 lemmaSpread
   */
  function search(query, { maxDistance, stats }) {
    const q = Array.from(query)
    const n = q.length
    if (n < g.minStem + 1) return []
    /**
     * 上限：一開始是 maxDistance；找到命中之後收緊成「目前最佳 ＋ lemmaSpread」。最後只保留最佳 ＋ lemmaSpread
     * 之內的詞根，而目前最佳只會下降，所以收緊不會丟掉任何最後會保留的詞根（結果與不收緊時相同）。
     */
    let bound = maxDistance + EPS
    const dawg = index.dawg
    /** @type {Map<string, ChartHit>} */
    const best = new Map()
    /** @type {Map<string, Walk['kind']>} 每個詞根的最佳分析來自哪一種走訪（只在要統計時記） */
    const via = new Map()

    /**
     * 一個查詢變體的三個階段。
     * @param {string[]} x
     * @param {Variant | null} variant
     */
    const analyze = (x, variant) => {
      /** @type {Map<string, Walk>} */
      const walks = new Map()
      /**
       * 把前綴那側的分析登記到一個走訪上。
       * @param {string} key
       * @param {Omit<Walk, 'users'>} walk
       * @param {User} user
       */
      const use = (key, walk, user) => {
        let w = walks.get(key)
        if (!w) walks.set(key, (w = { ...walk, users: [] }))
        w.users.push(user)
      }

      // ── 1. 前綴那側 ──
      const P = makePath(x, stats)
      // 還原變體：前綴那側必須正好在詞根的起點 i 結束（見 cap）
      if (variant) P.cap = variant.i
      /**
       * 加一段固定的字元（詞綴）：它的第一個字元之前那一欄必須已經定案；之後每一欄依下一個字元定案。
       * 最後一個字元之後的那一欄不定案。超過上限時回傳 false。
       * @param {string[]} chars
       * @param {number} spent
       */
      const append = (chars, spent) => {
        P.push(chars[0])
        for (let k = 1; k < chars.length; k++) {
          const c = P.column(modeBefore(chars[k]))
          if (P.lowerBound(c) + spent > bound) return false
          P.commit(c, false)
          P.push(chars[k])
        }
        return true
      }
      /**
       * 詞根可以從第 b ＝ P.length 欄開始（交界，這一欄的交界版本是 j）：登記到需要的走訪上。
       * @param {Float64Array} j
       * @param {Unit[]} pre
       * @param {ConstructionUnit | null} cons
       * @param {number} spent
       * @param {number} segment 最後一段（前綴單位或組合規則的左邊）的長度：跨界規則只能跨這一個交界
       */
      const offer = (j, pre, cons, spent, segment) => {
        const right = cons?.right ?? variant?.cons?.right ?? []
        const rk = right.join('')
        if (variant) {
          // 還原變體：詞根的起點固定在 i，固定的交界不能被跨越（沒有跨界的走訪）
          const v = j[variant.i] + spent
          if (v <= bound) use('J', { kind: 'junction', a: variant.i, head: [], right }, { pre, cons, spent, base: v })
          return
        }
        for (let a = 0; a <= x.length; a++) {
          const v = j[a] + spent
          if (v <= bound) use(`J${a}|${rk}`, { kind: 'junction', a, head: [], right }, { pre, cons, spent, base: v })
        }
        // 跨越交界的規則（只有沒有位置限制的方言規則，bcdp.md 1.3 第 3 項）：target 的前 k 個字元是最後一段的結尾，
        // 其餘是詞根的開頭；source 不能含空白（空白只能在詞幹內消耗）
        const b = P.length
        crossRules.forEach((r, ri) => {
          for (let k = 1; k < r.target.length && k <= segment; k++) {
            let tail = true
            for (let t = 0; t < k; t++) if (P.u[b - k + t] !== r.target[t]) tail = false
            if (!tail) continue
            const from = P.col(b - k)
            for (let a = r.source.length; a <= x.length; a++) {
              if (!P.sourceEndsAt(r, a)) continue
              const a0 = a - r.source.length
              if (P.spends(a0, a)) continue
              const v = from[a0] + r.weight + spent
              if (v <= bound) use(`X${ri}|${k}|${a}|${rk}`, { kind: 'cross', a, head: r.target.slice(k), right }, { pre, cons, spent, base: v })
            }
          }
        })
      }
      /**
       * 在第 P.length 欄（尚未定案）：詞根可以從這裡開始；也可以先接最內層的組合規則的左邊，
       * 或再加一個前綴單位（至多 maxSteps 個；組合規則不佔 maxSteps，與 BCDP 相同）。
       * @param {Unit[]} pre
       * @param {number} spent
       * @param {number} segment 最後一段的長度
       */
      const prefixSide = (pre, spent, segment) => {
        const b = P.length
        /** @type {Float64Array | null} 這一欄的交界版本（b > 0 時所有選擇共用） */
        let j = null
        if (b === 0) {
          // 詞首：沒有前綴。還原變體的詞根只能在查詢的開頭（ref-morph）
          if (!variant || variant.i === 0) use('O', { kind: 'origin', a: 0, head: [], right: variant?.cons?.right ?? [] }, { pre, cons: null, spent, base: spent })
        } else {
          j = P.column('J')
          if (P.lowerBound(j) + spent > bound) return
          offer(j, pre, null, spent, segment)
        }
        /** @param {string[]} chars @param {number} cost @param {() => void} then */
        const extend = (chars, cost, then) => {
          if (spent + cost > bound) return
          if (j) P.commit(j, true)
          else {
            const c = P.column(modeBefore(chars[0]))
            if (P.lowerBound(c) + spent + cost > bound) return
            P.commit(c, false)
          }
          if (append(chars, spent + cost)) then()
          P.cut(b)
        }
        // 最內層的組合規則（前綴式）：左邊之後就是詞根，詞根開頭是交界
        if (!variant) {
          for (const cons of prefixConstructions) {
            extend(cons.left, cons.cost, () => {
              const c = P.column('J')
              if (P.lowerBound(c) + spent + cons.cost <= bound) offer(c, pre, cons, spent + cons.cost, cons.left.length)
            })
          }
        }
        if (pre.length < g.maxSteps) for (const unit of prefixUnits) extend(unit.chars, unit.cost, () => prefixSide([...pre, unit], spent + unit.cost, unit.chars.length))
      }
      prefixSide([], variant?.cost ?? 0, 0)

      // ── 2、3. 詞根走訪與組合：起點便宜的先走，上限較快收緊 ──
      const order = [...walks.values()].map((w) => {
        w.users.sort((p, r) => p.base - r.base)
        return w
      })
      order.sort((p, r) => p.users[0].base - r.users[0].base)
      for (const w of order) {
        if (w.users[0].base > bound) continue
        for (const c of walk(x, variant, w)) {
          for (const user of w.users) {
            if (c.align + c.spent + user.base > bound) break
            if (record(x, c.term, c.align + user.base - user.spent, user.pre, user.cons ?? variant?.cons ?? null, variant, c.suf, user.spent + c.spent) && stats) via.set(c.term, w.kind)
          }
        }
      }
    }

    /**
     * 一次詞根走訪：由單一個格子出發（成本 0），走詞根、接後綴那側，回傳完成的（詞根, 後綴單位, 對齊成本, 後綴的步驟成本）。
     * 剪枝的上限扣掉登記在這裡的分析中最小的起點成本。
     * @param {string[]} x
     * @param {Variant | null} variant
     * @param {Walk} w
     */
    const walk = (x, variant, w) => {
      if (stats) stats.walks = (stats.walks ?? 0) + 1
      const P = makePath(x, stats, { a: w.a, b: w.head.length })
      const minBase = w.users[0].base
      /** @param {number} v 走訪內的成本 */
      const over = (v) => v + minBase > bound
      /** @type {Array<{term: string, align: number, suf: Unit[], spent: number}>} */
      const done = []
      const right = w.right
      const ends = variant?.ends ?? null
      const cons = variant?.cons ?? null

      /** 同 analyze 的 append（剪枝扣掉 minBase） @param {string[]} chars @param {number} spent */
      const append = (chars, spent) => {
        P.push(chars[0])
        for (let k = 1; k < chars.length; k++) {
          const c = P.column(modeBefore(chars[k]))
          if (over(P.lowerBound(c) + spent)) return false
          P.commit(c, false)
          P.push(chars[k])
        }
        return true
      }
      /** @param {string} term @param {number} align @param {Unit[]} suf @param {number} spent */
      const complete = (term, align, suf, spent) => {
        if (!over(align + spent)) done.push({ term, align, suf, spent })
      }
      /**
       * 後綴那側：組合規則的右邊（若有）之後，或前一個後綴單位之後。第 P.length 欄尚未定案。
       * @param {string} term @param {Unit[]} suf @param {number} spent
       */
      const suffixSide = (term, suf, spent) => {
        const b = P.length
        complete(term, P.column('F')[x.length], suf, spent)
        if (suf.length >= g.maxSteps) return
        const j = P.column('J')
        if (over(P.lowerBound(j) + spent)) return
        for (const unit of suffixUnits) {
          if (over(spent + unit.cost)) continue
          P.commit(j, true)
          if (append(unit.chars, spent + unit.cost)) suffixSide(term, [...suf, unit], spent + unit.cost)
          P.cut(b)
        }
      }
      /**
       * 詞根在第 P.length 欄結束（尚未定案）：詞尾就在這裡，或接組合規則的右邊與後綴。
       * @param {string} term
       */
      const stemEnd = (term) => {
        const b = P.length
        P.s1 = b
        // 詞尾就在詞根之後。還原變體沒有後綴（也不是組合規則）時，詞根必須在查詢的結尾結束（ref-morph 的 hasSuffix）
        if (right.length === 0) {
          const allowed = ends && !cons ? new Set(ends.has(x.length) ? [x.length] : []) : ends
          if (!allowed || allowed.size) {
            if (allowed) P.pins.push({ b, allowed })
            complete(term, P.column('F')[x.length], [], 0)
            if (allowed) P.pins.pop()
          }
        }
        // 接組合規則的右邊，或至少一個後綴
        if (right.length || (g.maxSteps > 0 && suffixUnits.length)) {
          if (ends) P.pins.push({ b, allowed: ends })
          const j = P.column('J')
          if (!over(P.lowerBound(j))) {
            if (right.length) {
              P.commit(j, true)
              if (append(right, 0)) suffixSide(term, [], 0)
              P.cut(b)
            } else {
              for (const unit of suffixUnits) {
                if (over(unit.cost)) continue
                P.commit(j, true)
                if (append(unit.chars, unit.cost)) suffixSide(term, [unit], unit.cost)
                P.cut(b)
              }
            }
          }
          if (ends) P.pins.pop()
        }
        P.s1 = Infinity
      }

      // 詞根由第 0 欄開始（交界，或詞首）。跨界的走訪：詞根開頭 head 已被規則涵蓋，那幾欄不經過（∞），
      // 由規則之後的格子 (a, |head|) 出發
      P.s0 = 0
      const junction = w.kind !== 'origin' || (variant?.junctionStart ?? false)
      let node = dawg.root
      /** @type {string[]} */
      const term = []
      for (let k = 0; k < w.head.length; k++) {
        const e = dawg.findEdge(node, w.head[k])
        if (e < 0) return done
        P.commit(new Float64Array(x.length + 1).fill(Infinity), k === 0)
        P.push(w.head[k])
        term.push(w.head[k])
        node = dawg.target(e)
      }
      /** @param {number} node */
      const visit = (node) => {
        if (stats) stats.visitedNodes++
        const depth = term.length
        const b = depth
        if (depth > 0 && dawg.isFinal(node)) {
          const t = term.join('')
          if (t !== query && depth >= g.minStem) stemEnd(t)
        }
        /** @type {Partial<Record<'N' | 'F' | 'J', Float64Array | null>>} 同一欄的各版本（null＝超過上限） */
        const memo = {}
        for (let e = dawg.firstEdge(node); e < dawg.endEdge(node); e++) {
          const ch = dawg.label(e)
          const mode = depth === 0 && junction ? 'J' : modeBefore(ch)
          if (memo[mode] === undefined) {
            const c = P.column(mode)
            memo[mode] = over(P.lowerBound(c)) ? null : c
          }
          const c = memo[mode]
          if (!c) continue
          P.commit(c, mode === 'J')
          P.push(ch)
          term.push(ch)
          visit(dawg.target(e))
          term.pop()
          P.cut(b)
        }
      }
      visit(node)
      return done
    }

    /**
     * 記錄一個完成的分析：以推導產生器檢查表面與條件，加上懲罰。
     * @param {string[]} x 查詢變體
     * @param {string} term
     * @param {number} align 整個詞的對齊成本
     * @param {Unit[]} pre
     * @param {ConstructionUnit | null} cons
     * @param {Variant | null} variant
     * @param {Unit[]} suf
     * @param {number} spent 步驟成本
     * @returns {boolean} 是否成為這個詞根目前的最佳分析
     */
    const record = (x, term, align, pre, cons, variant, suf, spent) => {
      const stemOp = variant?.stemOp ?? null
      if (pre.length + suf.length === 0 && !cons && !stemOp) return false // 至少一個構詞步驟
      const floor = round(align + spent)
      if (floor > bound) return false
      const prev = best.get(term)
      if (prev && prev.distance <= floor + EPS) return false
      const c = check(term, pre, cons, stemOp, suf)
      if (!c) return false
      const total = round(floor + c.penalty)
      if (total > bound) return false
      if (total + g.lemmaSpread + EPS < bound) bound = total + g.lemmaSpread + EPS
      if (prev && prev.distance <= total + EPS) return false
      best.set(term, {
        term,
        payloads: index.lookup(term) ?? [],
        distance: total,
        steps: stepsOf(pre, cons, stemOp, suf, variant?.red ?? null),
        ...(c.penalty > 0 ? { penalty: round(c.penalty), violations: c.violations } : {}),
        trace: traceOf(x, variant, term, pre, cons, suf),
      })
      return true
    }

    // ── 一般的分析：詞根上沒有非串接運算 ──
    analyze(q, null)

    // ── 還原變體：詞根上的中綴、重疊（自由的，或組合規則的第一個）在查詢上拿掉 ──
    /** @type {Array<{kind: 'infix' | 'reduplication', form: string, pattern: any, stemOp: StemOp | null, cons: ConstructionUnit | null, cost: number}>} */
    const ops = [
      ...stemOps.map((s) => ({ kind: s.kind, form: s.form, pattern: s.pattern, stemOp: s, cons: null, cost: s.cost })),
      ...constructions
        .filter((c) => c.shape === 'stem')
        .map((c) => {
          const s = /** @type {NonNullable<ConstructionUnit['stemOp']>} */ (c.stemOp)
          return { kind: s.kind, form: s.form, pattern: s.pattern, stemOp: null, cons: c, cost: c.cost }
        }),
    ]
    /** 由 from 開始的首輔音（群）長度 @param {string[]} chars @param {number} from */
    const onset = (chars, from) => {
      let k = from
      while (k < chars.length && !isVowel(chars[k])) k++
      return k - from
    }
    for (const op of ops) {
      if (op.cost > bound) continue
      for (let i = 0; i < n; i++) {
        if (op.kind === 'infix') {
          // 中綴在詞幹首輔音之後；首輔音不含空白；拿掉之後首輔音不變、剩下的至少 minStem 個字元
          const h = i + onset(q, i)
          if (q.slice(i, h).some(isB)) continue
          const xs = Array.from(op.form)
          if (q.slice(h, h + xs.length).join('') !== op.form) continue
          const reduced = [...q.slice(0, h), ...q.slice(h + xs.length)]
          if (reduced.length - i < g.minStem) continue
          if (i + onset(reduced, i) !== h) continue
          const ends = new Set(Array.from({ length: reduced.length + 1 }, (_, e) => e).filter((e) => e > h))
          analyze(reduced, { i, junctionStart: false, ends, stemOp: op.stemOp, cons: op.cons, red: null, cost: op.cost })
        } else {
          // 重疊：q[i..i+len) 是重疊部分（不含空白）；詞幹由 s 開始（可以略過交界上增生的字元）
          for (let len = 1; i + len < n; len++) {
            if (n - i - len < g.minStem) break
            const red = q.slice(i, i + len)
            if (red.some(isB)) break
            const starts = [i + len]
            for (const ins of junctionInserts) if (q.slice(i + len, i + len + ins.length).join('') === ins.join('')) starts.push(i + len + ins.length)
            for (const s of starts) {
              const baseChars = q.slice(s)
              if (baseChars.length < g.minStem) continue
              /** @type {Set<number>} 詞根在還原後的查詢上可以在哪裡結束：模板由那段產生的正好是重疊部分 */
              const ends = new Set()
              for (let l = 1; l <= baseChars.length; l++) if (reduplicant(op.pattern, baseChars.slice(0, l), vowels) === red.join('')) ends.add(s - len + l)
              if (!ends.size) continue
              const reduced = [...q.slice(0, i), ...q.slice(i + len)]
              analyze(reduced, { i, junctionStart: true, ends, stemOp: op.stemOp, cons: op.cons, red: red.join(''), cost: op.cost })
            }
          }
        }
      }
    }

    const hits = [...best.values()].sort((a, b) => a.distance - b.distance || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    if (!hits.length) return []
    const cutoff = hits[0].distance + g.lemmaSpread + EPS
    const kept = hits.filter((h) => h.distance <= cutoff)
    if (stats) stats.crossBest = (stats.crossBest ?? 0) + kept.filter((h) => via.get(h.term) === 'cross').length
    return kept
  }

  /**
   * 重建對齊用的資料：各詞素依詞中的順序接起來；還原變體的詞根起點、結尾固定在查詢的位置上（與搜尋時相同的限制）。
   * @param {string[]} x
   * @param {Variant | null} variant
   * @param {string} term
   * @param {Unit[]} pre
   * @param {ConstructionUnit | null} cons
   * @param {Unit[]} suf
   * @returns {ChartTrace}
   */
  function traceOf(x, variant, term, pre, cons, suf) {
    const seg = (/** @type {'prefix' | 'stem' | 'suffix'} */ type, /** @type {string[]} */ chars) => ({ chars, lock: type !== 'stem', type })
    const left = cons?.shape === 'prefix' ? [seg('prefix', cons.left)] : []
    const segments = [
      ...pre.map((u) => seg('prefix', u.chars)),
      ...left,
      seg('stem', Array.from(term)),
      ...(cons?.right.length ? [seg('suffix', cons.right)] : []),
      ...suf.map((u) => seg('suffix', u.chars)),
    ]
    /** @type {ChartTrace['options']} */
    const options = {}
    if (variant) {
      const stem = pre.length + left.length
      if (stem === 0) options.startEdge = variant.junctionStart ? EDGE_JUNCTION : EDGE_WORD
      options.pinStart = { segment: stem, x: variant.i }
      // 沒有後綴（也不是組合規則）時詞根必須在查詢的結尾結束，與 stemEnd 相同
      const last = suf.length === 0 && !cons
      options.pinEnd = { segment: stem, allowed: last ? new Set(variant.ends.has(x.length) ? [x.length] : []) : variant.ends }
    }
    return { query: x, segments, options }
  }

  /**
   * 命中的步驟（由外而內），格式與 BCDP 的 MorphStepHit 相同。
   * @param {Unit[]} pre
   * @param {ConstructionUnit | null} cons
   * @param {StemOp | null} stemOp
   * @param {Unit[]} suf
   * @param {string | null} red
   */
  function stepsOf(pre, cons, stemOp, suf, red) {
    const unitStep = (/** @type {'prefix' | 'suffix'} */ type, /** @type {Unit} */ u) => ({
      type,
      form: u.chars.join(''),
      gloss: u.parts.length === 1 ? u.parts[0].gloss : null,
      cost: u.cost,
      parts: u.parts,
      ...(u.unattested ? { unattested: true } : {}),
    })
    /** @type {Array<Record<string, any>>} */
    const out = pre.map((u) => unitStep('prefix', u))
    if (cons) {
      const s = cons.stemOp
      const leftForm = s ? (s.kind === 'reduplication' ? (red ?? '') : s.form) : cons.left.join('')
      const suffix = cons.right.join('')
      out.push({
        type: 'circumfix',
        form: suffix ? `${leftForm}…${suffix}` : leftForm,
        left: { type: s ? s.kind : 'prefix', form: leftForm, ...(s?.kind === 'reduplication' ? { pattern: s.pattern } : {}) },
        suffix,
        gloss: cons.construction.gloss,
        cost: cons.cost,
        parts: cons.parts,
        construction: cons.construction,
      })
    } else if (stemOp) {
      out.push(
        stemOp.kind === 'infix'
          ? { type: 'infix', form: stemOp.form, gloss: stemOp.parts[0].gloss, cost: stemOp.cost, parts: stemOp.parts }
          : { type: 'reduplication', form: red ?? '', pattern: stemOp.pattern, gloss: stemOp.parts[0].gloss, cost: stemOp.cost, parts: stemOp.parts },
      )
    }
    out.push(...[...suf].reverse().map((u) => unitStep('suffix', u)))
    return out
  }

  return { search, units: { prefixUnits, suffixUnits, stemOps, constructions } }
}
