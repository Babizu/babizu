/**
 * @file 構詞搜尋：BCDP（Boundary-Coupled DP，邊界耦合 DP）。
 *
 * 問題（docs/bcdp.md 第 1 節）：查詢 q 是詞庫詞 t 的衍生形，可能帶著方言音變。一個「分析」是
 *
 *   前綴鏈 π ·（中綴或重疊 ω）· 詞幹 t · 後綴鏈 σ
 *
 * 成本是各步驟的成本，加上查詢與整個底層字串 π·t·σ 的加權編輯距離：同一套方言規則對整個詞計算，
 * 規則可以跨越詞素交界（ta-kita-aw → takitaw 的 aa → a），詞首、詞尾規則在交界也適用，
 * 構詞音變是只在交界適用的規則，也在同一個 DP 裡。
 *
 * 做法：DP 在一個詞素交界的狀態（交界列＋還沒走完的規則，fuzzy-index.js 的 JunctionState）就是它的
 * 全部過去，所以整個詞可以一段一段走，每一段都是同一個原語——「從交界狀態出發，在 trie／詞圖上走訪」。
 * 同一個交界上不同來源的狀態逐項取 min 就能合併（(min, +) 線性，結果精確）：
 * 1. 前綴鏈：由詞首出發，一層一層走前綴 trie；第 s 層合併了所有「恰好 s 個前綴」的鏈
 * 2. 後綴鏈：用鏡像距離函式，在反轉的查詢上由詞尾往內，做法相同
 * 3. 詞幹：各層前綴合併成一個起點，與普通搜尋共用一次詞圖走訪；走到詞尾時與合併後的後綴狀態耦合，
 *    得到整個分析的成本
 * 中綴、重疊是查詢上的模板（重疊複製的是查詢中的形式）：先在查詢上還原，交界固定在查詢的位置上。
 * 走訪得到的就是精確成本；是哪一條詞綴鏈，只對命中的詞另外追出來（合併時每一格都記著它來自哪個詞綴）。
 *
 * ## 同位詞素的條件（構詞文法，docs/morph-grammar.md 2.2、5.1）
 * 條件看的是底層：前綴那側由詞綴往後讀到詞根結尾，後綴那側往前讀到詞根開頭。一個交界上還沒決定的條件
 * （例如 mu- 的 `^C+[ua]` 還沒讀到元音）是交界狀態的一部分：還沒決定的條件不同，之後的成本就不同，
 * 所以**只有條件相同的狀態才能取 min 合併**。每一層（與合併後的起點、詞尾耦合對象）因此依「還沒決定的
 * 條件」分類（Map：checksKey → 狀態），詞綴 trie 與詞庫詞圖的走訪讓條件沿著底層的字元前進
 * （fuzzy-index.js 的 checks）。不成立的條件加上懲罰，結果仍然精確。規格沒有條件時只有一類（鍵是空字串），
 * 每一步都與沒有這個功能時相同。
 */

import { EDGE_JUNCTION, EDGE_WORD, EPSILON, roundCost } from './dp.js'
import { FuzzyIndex } from './fuzzy-index.js'
import { emptyEnd, emptyJunction, isReachable, mergeEndInto, mergeInto, minOf, toForwardEnd } from './junction.js'
import { circumfixStep } from './morphology.js'

/** @typedef {import('./fuzzy-index.js').JunctionState} JunctionState */
/** @typedef {import('./fuzzy-index.js').JunctionEnd} JunctionEnd */
/** @typedef {import('./fuzzy-index.js').SearchResult} SearchResult */
/** @typedef {import('./morphology.js').Gloss} Gloss */
/** @typedef {import('./distance.js').Entry} Entry */

/**
 * @typedef {object} AffixEntry 詞綴清單中的一項（已正規化）
 * @property {string} form
 * @property {Gloss} gloss
 * @property {number} cost
 * @property {import('./grammar/compile.js').Part[]} [parts] 文法寫法：由哪些詞素構成
 * @property {{start: Check[], end: Check[]}} [checks] 文法寫法：搜尋時才能決定的條件
 */

/**
 * @typedef {JunctionState & {tags?: {row: unknown[], pending: Map<number, unknown[]>}, checks: Check[]}} Level
 *   一層詞綴合併後的交界狀態；tags 記下每一格的來源（詞綴與前一層的類別）；checks 是這一類還沒決定的條件
 */

/** @typedef {import('./grammar/compile.js').Check} Check */

/** @typedef {Map<string, Level>} Classes 依「還沒決定的條件」分類的交界狀態（鍵是 checksKey） */

/**
 * @typedef {object} MorphStepHit 命中說明中的一個構詞步驟
 * @property {'prefix' | 'suffix' | 'infix' | 'reduplication' | 'circumfix'} type
 * @property {string} form 標準形式（規格中的寫法；重疊是查詢中的重疊部分；環綴是「左邊…後綴」）
 * @property {string} [pattern] 重疊的型式
 * @property {{type: 'prefix' | 'infix' | 'reduplication', form: string, pattern?: string}} [left] 環綴左邊的部分
 * @property {string} [suffix] 環綴的後綴
 * @property {Gloss} gloss
 * @property {number} cost 步驟本身的成本（音變另外算在整個詞的對齊裡）
 * @property {import('./grammar/compile.js').Part[]} [parts] 文法寫法：由哪些詞素構成（推導順序）
 * @property {{id: string, gloss: Gloss}} [construction] 文法寫法：哪一條組合規則
 */

/**
 * @typedef {object} MorphHit
 * @property {string} term 命中的詞庫詞（詞幹）
 * @property {unknown[]} payloads
 * @property {number} distance 分析的成本：步驟成本＋整個詞的音變（＋不成立的條件的懲罰）
 * @property {number} [penalty] 不成立的同位詞素條件的懲罰總和（構詞文法；沒有時省略）
 * @property {import('./grammar/compile.js').Violation[]} [violations] 不成立的條件（有 penalty 時才有）
 * @property {MorphStepHit[]} steps 由外而內
 * @property {{variant: number, prefixes: AffixEntry[], suffixes: AffixEntry[], circumfix: Circumfix | null}} analysis
 *   用了哪一個通道、哪些前綴與後綴（由外而內，不含環綴的兩側）、哪個環綴，說明（explainHit）用
 */

/**
 * @typedef {object} Circumfix 環綴（已正規化）：左邊的部分（前綴、中綴，或重疊型式）與後綴
 * @property {'prefix' | 'infix' | 'reduplication'} kind
 * @property {string} left
 * @property {string} suffix
 * @property {Gloss} gloss
 * @property {number} cost
 */

/**
 * @typedef {object} Variant 一個搜尋通道：原查詢，或拿掉中綴、重疊部分的查詢
 * @property {'plain' | 'prefix' | 'circumfix' | 'infix' | 'reduplication'} kind plain：沒有前綴、至少一個後綴；
 *   prefix：至少一個前綴；circumfix：前綴式的環綴緊貼詞幹；infix、reduplication：還原變體（op 可以是環綴）
 * @property {Circumfix | null} circumfix 這個通道的環綴（前綴式環綴的通道由後綴相同的幾個環綴共用，這裡是 null，
 *   命中是哪一個由起點狀態的 tag 決定）
 * @property {string | null} suffix 詞尾要接的環綴後綴（null：接一般的後綴鏈，或就是詞尾）
 * @property {MorphStepHit[]} [options] 共用這個通道的步驟（前綴式環綴的通道：後綴相同的環綴；還原變體：單獨的中綴、重疊，
 *   與用它當左邊的環綴），說明用
 * @property {Array<{op: MorphStepHit, circumfix: Circumfix | null, suffix: string | null, cost: number, endChecks: Check[]}>} [members]
 *   還原變體共用通道的各個步驟：成本移到詞尾耦合，詞尾取各步驟的最小值；命中是哪一個由出口決定
 * @property {Level} [startState] 前綴式環綴的通道：合併後的起點狀態（tag 是環綴）
 * @property {string[]} chars 查詢（變體是還原後的查詢）
 * @property {MorphStepHit | null} op 非串接步驟
 * @property {number} start 變體的詞幹起點（固定）；−1 表示不固定
 * @property {boolean} prefixed 變體的詞幹前面有前綴鏈（否則詞幹在詞首）
 * @property {number} startEdge 詞幹起點的位置種類
 * @property {number} cut 變體拿掉的位置（原查詢）；len 拿掉的字元數
 * @property {number} len
 * @property {(x: number) => boolean} ends 變體上詞幹可以結束的位置
 * @property {string} [startKey] 起點是前綴狀態的哪一類（條件分類的鍵）
 * @property {Array<{kind: string, key?: string, suffix?: string}>} [targets] 詞尾耦合的各對象是哪一類（與通道的 to 對應）
 * @property {Array<Array<{member: any, endRow: Float64Array | null, meta: any}>>} [sources]
 *   還原變體：各對象的最小值由哪些步驟、哪一類組成（說明時找出實際用的是哪一個）
 */

/** 條件（DFA）的識別碼：同一個條件物件同一個號碼 */
const condIds = new WeakMap()
let nextCondId = 0

/**
 * 一組還沒決定的條件的鍵：條件、DFA 狀態、懲罰都相同的兩組，之後的成本完全相同，可以合併。
 * 沒有條件時是空字串（規格沒有條件時只有這一類）。
 * @param {Check[]} checks
 */
export function checksKey(checks) {
  if (checks.length === 0) return ''
  return checks
    .map((k) => {
      let id = condIds.get(k.cond)
      if (id === undefined) condIds.set(k.cond, (id = nextCondId++))
      return `${id}:${k.state}:${k.penalty}`
    })
    .sort()
    .join(',')
}

/**
 * 條件在一段已知的字元上讀完之後的懲罰：讀到吸收態就停，仍未接受就付懲罰（死狀態或讀完仍未決定）。
 * @param {Check[]} checks
 * @param {string[]} chars 依條件讀的順序（後綴那側要先反轉）
 * @param {import('./grammar/compile.js').Violation[]} [into] 收集不成立的條件（說明用）
 */
function penaltyOn(checks, chars, into) {
  let sum = 0
  for (const { cond, state, penalty, owner } of checks) {
    let st = state
    for (let k = 0; k < chars.length && cond.status(st) === 0; k++) st = cond.step(st, chars[k])
    if (cond.status(st) <= 0) {
      sum += penalty
      if (into && owner) into.push({ id: owner.id, form: owner.form, when: cond.source, penalty })
    }
  }
  return sum
}

/** 還原變體（中綴、重疊）的上限：防止很長的查詢展開成上百個通道；超過時 prepare 的結果標記 truncated */
const MAX_VARIANTS = 64

/** 詞綴鏈的快取上限（同一個網頁工作階段中重複查詢時省下重算） */
const CACHE_LIMIT = 500

/**
 * 建立構詞搜尋器。
 *
 * 詞綴索引在建立時就建好，詞綴鏈也會快取；之後若以 `metric.setRules` 換了方言規則，
 * 要呼叫 clearCache（或重新建立構詞搜尋器）。
 * @param {object} deps
 * @param {import('./morphology.js').Analyzer} deps.analyzer 構詞規格（已正規化）
 * @param {import('./distance.js').WeightedEditDistance} deps.metric 與詞庫相同的距離函式（含構詞音變）
 * @param {FuzzyIndex} deps.index 詞庫
 */
export function createMorphSearch({ analyzer, metric, index }) {
  const spec = analyzer.spec
  const mirror = metric.mirror()
  const reverse = (/** @type {string} */ s) => Array.from(s).reverse().join('')
  const prefixIndex = new FuzzyIndex(metric)
  for (const a of spec.prefixes) prefixIndex.add(a.form, a)
  const suffixIndex = new FuzzyIndex(mirror)
  for (const a of spec.suffixes) suffixIndex.add(reverse(a.form), a)
  /** 詞邊界字元（預設為空白）：詞綴、中綴、重疊部分都不能包含它（docs/bcdp.md 1.6） */
  const isBoundary = (/** @type {string | undefined} */ ch) => ch !== undefined && metric.boundaries.has(ch)
  /**
   * 交界上「只動查詢」的規則的 source：target 為空、可以用在詞素開頭（例如喉塞音 ' → ∅）。
   * 重疊部分與詞幹之間也是交界，這些字元屬於交界、不屬於詞幹，重疊模板略過它們（docs/bcdp.md 1.4）。
   */
  const junctionInserts = [
    ...new Set(
      metric.ruleSet
        .expand(metric.normalize)
        .filter((r) => r.target === '' && r.source !== '' && r.position !== 'final')
        .map((r) => r.source),
    ),
  ].map((s) => Array.from(s))

  /** 環綴兩側：前綴式環綴的左邊（詞綴 trie）、所有環綴的後綴（鏡像、反轉） */
  const circumfixes = /** @type {ReadonlyArray<Circumfix>} */ (spec.circumfixes ?? [])
  const circPrefixIndex = new FuzzyIndex(metric)
  for (const c of circumfixes) if (c.kind === 'prefix' && !circPrefixIndex.lookup(c.left)) circPrefixIndex.add(c.left, c.left)
  const circSuffixIndex = new FuzzyIndex(mirror)
  // 只有前綴的組合規則（m<in>u-）沒有右邊：詞尾接一般的後綴鏈，不在這個 trie 裡
  for (const c of circumfixes) if (c.suffix && !circSuffixIndex.lookup(reverse(c.suffix))) circSuffixIndex.add(reverse(c.suffix), c.suffix)
  /** 中綴與重疊的用法：單獨的步驟，或環綴的左邊（詞尾另外要接環綴的後綴） */
  /** 中綴、重疊的用法各自的條件（文法寫法才有）：start 由詞根開頭讀，end 由詞根結尾讀（環綴的後綴那側） */
  const noChecks = { start: /** @type {Check[]} */ ([]), end: /** @type {Check[]} */ ([]) }
  /** @type {Array<{form: string, op: (left: string) => MorphStepHit, circumfix: Circumfix | null, checks: {start: Check[], end: Check[]}}>} */
  const infixUses = []
  for (const x of spec.infixes) infixUses.push({ form: x.form, op: () => affixStep('infix', x), circumfix: null, checks: x.checks ?? noChecks })
  for (const c of circumfixes) if (c.kind === 'infix') infixUses.push({ form: c.left, op: (l) => /** @type {MorphStepHit} */ (circumfixStep(c, l)), circumfix: c, checks: c.checks ?? noChecks })
  /** @type {Array<{pattern: any, op: (red: string) => MorphStepHit, circumfix: Circumfix | null, checks: {start: Check[], end: Check[]}}>} */
  const redupUses = []
  for (const r of spec.reduplication) {
    redupUses.push({
      pattern: r.pattern,
      op: (red) => ({ type: 'reduplication', form: red, pattern: r.pattern, gloss: r.gloss, cost: r.cost, ...(r.parts ? { parts: r.parts } : {}) }),
      circumfix: null,
      checks: r.checks ?? noChecks,
    })
  }
  for (const c of circumfixes) if (c.kind === 'reduplication') redupUses.push({ pattern: c.left, op: (red) => /** @type {MorphStepHit} */ (circumfixStep(c, red)), circumfix: c, checks: c.checks ?? noChecks })

  /** 規格中有沒有任何條件（沒有時不必計算懲罰） */
  const conditioned = [spec.prefixes, spec.suffixes, spec.infixes, spec.reduplication, circumfixes].some((list) => list.some((/** @type {any} */ e) => e.checks))

  /** @type {Map<string, any>} 詞綴各層（Level[]）與環綴兩側（Map） */
  const cache = new Map()

  /**
   * 詞綴鏈，一層一層合併：第 s 層是「恰好 s 個詞綴」的所有鏈在最內側交界的狀態，逐項取 min 合併，
   * 每一格記下來源（哪一個詞綴、由前一層的哪一類走過來；同分時保留先找到的：trie 的順序）。
   * 每一層只走訪一次詞綴 trie：前一層的每一類是一個通道（帶著它還沒決定的條件，沿詞綴的字元讀下去），
   * 詞尾回報的交界狀態加上詞綴本身的成本，依「還沒決定的條件」（前一層留下的 ＋ 這個詞綴自己的）併進這一層。
   * 前綴由詞首往內；後綴用鏡像距離函式，在反轉的查詢上由詞尾往內，做法相同（條件由詞尾往前讀，方向一致）。
   * @param {FuzzyIndex} idx 前綴 trie，或鏡像距離函式的反轉後綴 trie
   * @param {string[]} x 查詢（後綴時是反轉的查詢）
   * @param {number} bound 總成本上限（之後的成本只會增加，超過的格子可以丟掉）
   * @param {string} tag 快取鍵的前綴
   * @param {'start' | 'end'} side 詞綴自己的條件取哪一側（前綴 start、後綴 end）
   * @returns {Classes[]} 第 1 … maxSteps 層（到沒有任何格子在上限內為止）
   */
  function levels(idx, x, bound, tag, side) {
    const key = `${tag}|${bound}|${x.join('')}`
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    const n = x.length
    /** @type {Classes[]} */
    const out = []
    /** @type {Classes | undefined} */
    let prev
    for (let s = 0; s < spec.maxSteps; s++) {
      /** @type {Classes} */
      const next = new Map()
      /** @type {Array<[string, Level | undefined]>} */
      const froms = prev ? [...prev] : [['', undefined]]
      idx.searchChannels(
        froms.map(([fromKey, from]) => ({
          query: x,
          options: {
            maxDistance: bound,
            from,
            checks: from?.checks,
            lockBoundary: true, // 詞綴不含空白
            onJunction: (/** @type {string} */ _form, /** @type {JunctionState} */ state, /** @type {unknown[]} */ payloads, /** @type {Check[]} */ pending) => {
              for (const affix of /** @type {AffixEntry[]} */ (payloads)) {
                const own = affix.checks?.[side] ?? []
                const checks = own.length ? [...pending, ...own] : pending
                const k = checksKey(checks)
                let level = next.get(k)
                if (!level) next.set(k, (level = Object.assign(emptyJunction(n), { checks })))
                mergeInto(level, state, affix.cost, { affix, from: fromKey })
              }
            },
          },
        })),
      )
      for (const [k, level] of next) {
        clip(level, bound)
        if (!isReachable(level)) next.delete(k)
      }
      if (next.size === 0) break
      out.push(next)
      prev = next
    }
    cache.set(key, out)
    if (cache.size > CACHE_LIMIT) cache.delete(/** @type {string} */ (cache.keys().next().value))
    return out
  }

  /**
   * 環綴一側的交界狀態：在環綴那一側的 trie（前綴式環綴的左邊，或鏡像、反轉的後綴）上，由詞首（詞尾）
   * 與合併後的詞綴狀態的每一類各走訪一次，每個形式得到「它是最內層」時的交界狀態（依還沒決定的條件分類）。
   * tag 記下來源：origin 0 ＝ 詞首（詞尾），1 ＝ 接在詞綴鏈之後（from 是那一類，說明時由那裡再追詞綴鏈）。
   * 環綴自己的條件不在這裡加：它依環綴而不同，由呼叫端在分組時加上。
   * @param {FuzzyIndex} idx
   * @param {string[]} x 查詢（後綴時是反轉的查詢）
   * @param {Classes} after 合併後的詞綴狀態
   * @param {number} bound 總成本上限
   * @param {string} tag 快取鍵的前綴
   * @returns {Map<string, Classes>} 形式 → 各類的交界狀態（只有到得了的）
   */
  function sides(idx, x, after, bound, tag) {
    const key = `${tag}|${bound}|${x.join('')}`
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    const n = x.length
    /** @type {Map<string, Classes>} */
    const out = new Map()
    /** @type {Array<{from: Level | undefined, origin: number, fromKey: string}>} */
    const origins = [{ from: undefined, origin: 0, fromKey: '' }]
    for (const [fromKey, level] of after) if (isReachable(level)) origins.push({ from: level, origin: 1, fromKey })
    idx.searchChannels(
      origins.map(({ from, origin, fromKey }) => ({
        query: x,
        options: {
          maxDistance: bound,
          from,
          checks: from?.checks,
          lockBoundary: true, // 詞綴不含空白
          onJunction: (/** @type {string} */ _form, /** @type {JunctionState} */ state, /** @type {unknown[]} */ payloads, /** @type {Check[]} */ pending) => {
            for (const form of new Set(/** @type {string[]} */ (payloads))) {
              let classes = out.get(form)
              if (!classes) out.set(form, (classes = new Map()))
              const k = checksKey(pending)
              let level = classes.get(k)
              if (!level) classes.set(k, (level = Object.assign(emptyJunction(n), { checks: pending })))
              mergeInto(level, state, 0, { origin, from: fromKey })
            }
          },
        },
      })),
    )
    for (const [form, classes] of out) {
      for (const [k, level] of classes) {
        clip(level, bound)
        if (!isReachable(level)) classes.delete(k)
      }
      if (classes.size === 0) out.delete(form)
    }
    cache.set(key, out)
    if (cache.size > CACHE_LIMIT) cache.delete(/** @type {string} */ (cache.keys().next().value))
    return out
  }

  /**
   * 還原變體：在每個可能的詞幹起點 i（詞首，或某條前綴鏈的終點）拿掉中綴或重疊部分。
   * 變體的交界固定在查詢的位置上：詞幹由 i 開始（規則不跨越），並在允許的位置結束。
   * @param {string[]} chars
   * @param {Classes} P 各層前綴合併後的狀態（依還沒決定的條件分類）
   * @returns {Generator<Variant & {startCost: number, startKey: string, startChecks: Check[], opChecks: {start: Check[], end: Check[]}}>}
   */
  function* restored(chars, P) {
    const n = chars.length
    // 詞幹的起點：詞首（沒有前綴），或某條前綴鏈的終點（交界；每一類分開，條件不同）。詞首與交界的語意不同
    // （構詞音變只在交界適用），所以 i ＝ 0 時兩者都要試
    /** @type {Array<{i: number, startCost: number, prefixed: boolean, startKey: string, startChecks: Check[]}>} */
    const starts = [{ i: 0, startCost: 0, prefixed: false, startKey: '', startChecks: [] }]
    for (const [startKey, level] of P) {
      for (let i = 0; i < n; i++) if (level.row[i] < Infinity) starts.push({ i, startCost: level.row[i], prefixed: true, startKey, startChecks: level.checks })
    }
    for (const { i, startCost, prefixed, startKey, startChecks } of starts) {
      const head = Array.from(analyzer.onset(chars.slice(i).join('')))

      // 中綴：詞幹首輔音之後、首元音之前（首輔音不能含空白：構詞不跨越詞邊界）
      const at = i + head.length
      for (const x of head.some(isBoundary) ? [] : infixUses) {
        const xs = Array.from(x.form)
        if (chars.slice(at, at + xs.length).join('') !== x.form) continue
        const reduced = [...chars.slice(0, at), ...chars.slice(at + xs.length)]
        if (reduced.length - i < spec.minStem) continue
        if (analyzer.onset(reduced.slice(i).join('')) !== head.join('')) continue
        yield {
          kind: 'infix',
          chars: reduced,
          op: x.op(x.form),
          circumfix: x.circumfix,
          suffix: x.circumfix?.suffix ?? null,
          shape: `x|${prefixed}|${i}|${x.form}|${startKey}|${checksKey(x.checks.start)}`,
          start: i,
          startCost,
          startKey,
          startChecks,
          opChecks: x.checks,
          prefixed,
          startEdge: prefixed ? EDGE_JUNCTION : EDGE_WORD,
          cut: at,
          len: xs.length,
          ends: (/** @type {number} */ e) => e > at, // 詞幹必須越過中綴所在的位置
        }
      }

      // 重疊：詞幹前面的重疊部分，試每一種長度。模板只套用在詞幹上，而且詞幹取自查詢，
      // 所以複製的是查詢（方言）的形式；詞幹的長度只能是模板正好產生重疊部分的那些。
      // 重疊部分與詞幹之間是交界：交界上的增生（junctionInserts）不算在詞幹裡。
      // 重疊的詞幹開頭一定是交界，i ＝ 0 時由前綴鏈出發只會更貴，不必另外試
      for (const r of prefixed && i === 0 ? [] : redupUses) {
        for (let len = 1; i + len < n; len++) {
          if (n - i - len < spec.minStem) break
          if (isBoundary(chars[i + len - 1])) break // 重疊部分不跨越空白
          const red = chars.slice(i, i + len).join('')
          const starts = [i + len]
          for (const g of junctionInserts) if (chars.slice(i + len, i + len + g.length).join('') === g.join('')) starts.push(i + len + g.length)
          for (const s of starts) {
            const base = chars.slice(s)
            if (base.length < spec.minStem) continue
            const lengths = analyzer.reduplicantStems(r.pattern, base, red)
            if (!lengths.length) continue
            const ends = new Set(lengths.map((l) => s - len + l)) // 還原後的查詢上的位置
            yield {
              kind: 'reduplication',
              chars: [...chars.slice(0, i), ...chars.slice(i + len)],
              op: r.op(red),
              circumfix: r.circumfix,
              suffix: r.circumfix?.suffix ?? null,
              shape: `r|${prefixed}|${i}|${len}|${s}|${r.pattern}|${startKey}|${checksKey(r.checks.start)}`,
              start: i,
              startCost,
              startKey,
              startChecks,
              opChecks: r.checks,
              prefixed,
              startEdge: EDGE_JUNCTION,
              cut: i,
              len,
              ends: (/** @type {number} */ e) => ends.has(e),
            }
          }
        }
      }
    }
  }

  /**
   * @typedef {JunctionEnd & {checks: Check[], meta: TargetMeta}} Target 詞尾耦合的一個對象（fuzzy-index.js 的 to）
   * @typedef {{kind: 'S', key: string} | {kind: 'circS', suffix: string, key: string} | {kind: 'word'}} TargetMeta
   *   對象是哪一類：一般後綴鏈的某一類（S）、環綴後綴的某一類（circS），或只接受「就是詞尾」（word）
   */

  /**
   * @typedef {object} Prepared 構詞搜尋的準備結果
   * @property {string} query
   * @property {string[]} chars
   * @property {Classes[]} prefixLevels 第 1 … k 層前綴（正向；每層依還沒決定的條件分類）
   * @property {Classes[]} suffixLevels 第 1 … k 層後綴（反向：鏡像距離函式、反轉的查詢）
   * @property {Classes} P 各層前綴再合併（同一類的逐項取 min；tags 記的是層數與那一層的類別）
   * @property {Map<string, ReturnType<typeof emptyEnd> & {checks: Check[]}>} S 各層後綴換成正向座標後合併（同上）
   * @property {Variant[]} variants 與 channels 一一對應
   * @property {Array<{query: string[], options: import('./fuzzy-index.js').SearchOptions}>} channels
   * @property {import('./fuzzy-index.js').SpreadCutoff} cutoff 各通道共用的相對上限（seed 給起點，走訪時收緊）
   * @property {boolean} truncated 還原變體超過 MAX_VARIANTS 而被截斷
   * @property {Map<string, AffixEntry[]>} [chains] 找回詞綴鏈的備忘（affixesOf）
   * @property {{P: Map<string, Classes>, Sm: Classes, S: Map<string, Map<string, {mirror: Level, end: JunctionEnd & {checks: Check[]}}>>}} circ
   *   環綴兩側：P 是前綴式環綴的左邊緊接在前綴鏈之後的狀態（依形式、再依類別）；Sm 是各層後綴合併後的狀態（鏡像座標）；
   *   S 是環綴的後綴緊接在後綴鏈之前的狀態（鏡像座標，與換回正向的耦合對象）
   */

  /**
   * 構詞搜尋的第一步：算好前綴、後綴的各層與還原變體，產生詞幹的搜尋通道（交給 FuzzyIndex.searchChannels，
   * 搜尋引擎把它們與普通模糊搜尋合併成一次走訪）。
   * @param {string} query 已正規化的查詢（搜尋鍵）
   * @param {number} [maxDistance=1] 總成本上限
   * @returns {Prepared | null} 查詢太短時為 null
   */
  function prepare(query, maxDistance = 1) {
    const chars = Array.from(query)
    const n = chars.length
    if (n < spec.minStem + 1) return null
    const prefixLevels = levels(prefixIndex, chars, maxDistance, 'p', 'start')
    const suffixLevels = levels(suffixIndex, [...chars].reverse(), maxDistance, 's', 'end')
    /** 各層合併：同一類（還沒決定的條件相同）的逐項取 min，tag 記層數與類別 @param {Classes[]} list @returns {Classes} */
    const mergeLevels = (list) => {
      /** @type {Classes} */
      const out = new Map()
      list.forEach((classes, lv) => {
        for (const [k, L] of classes) {
          let into = out.get(k)
          if (!into) out.set(k, (into = Object.assign(emptyJunction(n), { checks: L.checks })))
          mergeInto(into, L, 0, { level: lv + 1, from: k })
        }
      })
      return out
    }
    const P = mergeLevels(prefixLevels)
    /** @type {Prepared['S']} */
    const S = new Map()
    suffixLevels.forEach((classes, lv) => {
      for (const [k, L] of classes) {
        let into = S.get(k)
        if (!into) S.set(k, (into = Object.assign(emptyEnd(n), { checks: L.checks })))
        mergeEndInto(into, toForwardEnd(L, mirror.compiled), { level: lv + 1, from: k })
      }
    })
    const word = new Float64Array(n + 1).fill(Infinity)
    word[n] = 0
    // 只保留「最佳 ＋ lemmaSpread」之內的詞根（finish），所以各通道共用一個相對上限，隨途中的最佳收緊。
    // 算進最佳的詞與 finish 相同（不是查詢本身、夠長），結果與不收緊時完全相同
    /** @type {import('./fuzzy-index.js').SpreadCutoff} */
    const cutoff = { best: Infinity, spread: spec.lemmaSpread, eligible: (term) => term !== query && Array.from(term).length >= spec.minStem }

    /** @type {Variant[]} */
    const variants = []
    /** @type {Prepared['channels']} */
    const channels = []
    // 環綴的兩側：各自是最內層（緊貼詞幹），外面可以再接一般的詞綴鏈
    const Sm = mergeLevels(suffixLevels)
    /** @type {Map<string, Classes>} */
    const circSuffixes = circumfixes.length ? sides(circSuffixIndex, [...chars].reverse(), Sm, maxDistance, 'cs') : new Map()
    const circ = {
      P: /** @type {Map<string, Classes>} */ (circumfixes.some((c) => c.kind === 'prefix') ? sides(circPrefixIndex, chars, P, maxDistance, 'cp') : new Map()),
      Sm,
      S: new Map(
        [...circSuffixes].map(([form, classes]) => [
          form,
          new Map([...classes].map(([k, L]) => [k, { mirror: L, end: Object.assign(toForwardEnd(L, mirror.compiled), { checks: L.checks }) }])),
        ]),
      ),
    }

    /**
     * 詞尾耦合的對象：一般後綴鏈的每一類一個；withWord 時也接受「就是詞尾」，併進條件相同的那一類
     * （沒有條件時只有一個對象，與沒有條件的版本完全相同）。extra：再加上的條件（例如還原變體的步驟、環綴的後綴那側）
     * @param {boolean} withWord
     * @param {Check[]} [extra]
     * @returns {Target[]}
     */
    const suffixTargets = (withWord, extra = []) => {
      /** @type {Target[]} */
      const list = []
      for (const [k, end] of S) list.push({ row: end.row, pending: end.pending, word: null, checks: extra.length ? [...end.checks, ...extra] : end.checks, meta: { kind: 'S', key: k } })
      if (withWord) {
        const wk = checksKey(extra)
        const same = list.find((t) => checksKey(t.checks) === wk)
        if (same) same.word = word
        else list.push({ row: null, pending: [], word, checks: extra, meta: { kind: 'word' } })
      }
      return list
    }
    /**
     * 環綴後綴那側的耦合對象：它的每一類一個。
     * @param {string} suffix
     * @param {Check[]} extra
     * @returns {Target[]}
     */
    const circTargets = (suffix, extra) =>
      [.../** @type {Map<string, {end: JunctionEnd & {checks: Check[]}}>} */ (circ.S.get(suffix))].map(([k, { end }]) => ({
        row: end.row,
        pending: end.pending,
        word: null,
        checks: extra.length ? [...end.checks, ...extra] : end.checks,
        meta: /** @type {TargetMeta} */ ({ kind: 'circS', suffix, key: k }),
      }))
    /** 對象只有一個時直接傳那一個（fuzzy-index.js 的結果才不會多出 exit.to） @param {Target[]} list */
    const toOption = (list) => (list.length === 1 ? list[0] : list)

    const plain = { start: -1, prefixed: false, cut: n, len: 0, ends: () => true, circumfix: null, suffix: null }
    // 沒有前綴：至少要有一個後綴
    if (suffixLevels.length) {
      const targets = suffixTargets(false)
      variants.push({ kind: 'plain', chars, op: null, startEdge: EDGE_WORD, ...plain, targets: targets.map((t) => t.meta) })
      channels.push({ query: chars, options: { maxDistance, cutoff, to: toOption(targets) } })
    }
    // 至少一個前綴：之後可以接後綴，也可以就是詞尾。前綴狀態的每一類一個通道（帶著它還沒決定的條件）
    if (prefixLevels.length) {
      for (const [k, Pk] of P) {
        const targets = suffixTargets(true)
        variants.push({ kind: 'prefix', chars, op: null, startEdge: EDGE_JUNCTION, ...plain, startKey: k, targets: targets.map((t) => t.meta) })
        channels.push({ query: chars, options: { maxDistance, cutoff, from: Pk, checks: Pk.checks, to: toOption(targets) } })
      }
    }
    // 前綴式的環綴：詞幹由它的左邊出發（成本加在起點），詞尾一定接它的後綴（沒有右邊時接一般的後綴鏈）。
    // 詞尾耦合的對象相同、條件也相同的環綴，起點（左邊的狀態加上環綴的成本）逐項取 min 合併成一個通道（定理 2）；
    // tag 記著是哪一個環綴、左邊的哪一類
    /** @type {Map<string, {suffix: string, start: Level, endChecks: Check[], options: MorphStepHit[]}>} */
    const bySuffix = new Map()
    for (const c of circumfixes) {
      const classes = c.kind === 'prefix' ? circ.P.get(c.left) : undefined
      if (!classes || (c.suffix && !circ.S.has(c.suffix))) continue
      const own = c.checks ?? noChecks
      for (const [k, Pc] of classes) {
        const startChecks = own.start.length ? [...Pc.checks, ...own.start] : Pc.checks
        const gk = `${c.suffix}|${checksKey(startChecks)}|${checksKey(own.end)}`
        let group = bySuffix.get(gk)
        if (!group) bySuffix.set(gk, (group = { suffix: c.suffix, start: Object.assign(emptyJunction(n), { checks: startChecks }), endChecks: own.end, options: [] }))
        mergeInto(group.start, Pc, c.cost, { circ: c, from: k })
        group.options.push(/** @type {MorphStepHit} */ (circumfixStep(c, c.left)))
      }
    }
    for (const { suffix, start, endChecks, options } of bySuffix.values()) {
      // 沒有右邊的組合規則（suffix 是空字串）：詞尾與「接在前綴之後」的通道相同，接一般的後綴鏈或就是詞尾
      const targets = suffix ? circTargets(suffix, endChecks) : suffixTargets(true, endChecks)
      // 起點與詞尾的成本都不小於它們的最小值：加起來已經超過上限的通道不可能有命中
      let endMin = Infinity
      for (const t of targets) {
        for (const vec of [t.row, t.word, ...t.pending.map((q) => q.row)]) if (vec) for (const v of vec) if (v < endMin) endMin = v
      }
      if (minOf(start) + endMin > maxDistance + EPSILON) continue
      variants.push({ kind: 'circumfix', chars, op: null, startEdge: EDGE_JUNCTION, ...plain, suffix: suffix || null, options, startState: start, targets: targets.map((t) => t.meta) })
      channels.push({ query: chars, options: { maxDistance, cutoff, from: start, checks: start.checks, to: toOption(targets) } })
    }
    // 還原變體：同一個位置、同一種拿法（shape，含起點的類別與步驟的條件）的變體，拿掉之後的查詢、詞幹的起點與
    // 可以結束的位置都相同，只差在步驟成本與詞尾接什麼（單獨的中綴、重疊接一般的後綴鏈或就是詞尾；環綴接它的後綴）。
    // 把步驟成本移到詞尾（加法可以交換），詞尾取各步驟的最小值，就能共用一個通道（(min, +) 線性）；
    // 詞尾接的類別與條件不同時分成不同的對象
    /** @type {Map<string, {v: any, members: NonNullable<Variant['members']>}>} */
    const groups = new Map()
    for (const v of restored(chars, P)) {
      // 環綴（中綴、重疊式）的後綴對不上查詢的結尾時，這個步驟不可能命中
      if (v.suffix !== null && !circ.S.has(v.suffix)) continue
      let group = groups.get(v.shape)
      if (!group) groups.set(v.shape, (group = { v, members: [] }))
      group.members.push({ op: /** @type {MorphStepHit} */ (v.op), circumfix: v.circumfix, suffix: v.suffix, cost: /** @type {MorphStepHit} */ (v.op).cost, endChecks: v.opChecks.end, opChecks: v.opChecks })
    }
    let truncated = false
    let count = 0
    for (const { v, members } of groups.values()) {
      if (count++ >= MAX_VARIANTS) {
        truncated = true
        break
      }
      const m = v.chars.length
      const original = (/** @type {number} */ x) => (x > v.cut ? x + v.len : x) // 變體上的位置 → 原查詢
      const from = new Float64Array(m + 1).fill(Infinity)
      from[v.start] = v.startCost
      /** @type {Map<string, Target & {sources: NonNullable<Variant['sources']>[number]}>} */
      const byKey = new Map()
      /** @param {Check[]} checks @param {TargetMeta} meta */
      const targetFor = (checks, meta) => {
        const k = checksKey(checks)
        let t = byKey.get(k)
        if (!t) byKey.set(k, (t = { row: new Float64Array(m + 1).fill(Infinity), pending: [], word: null, checks, meta, sources: [] }))
        return t
      }
      for (const member of members) {
        /** @type {Array<{row: Float64Array | null, checks: Check[], meta: TargetMeta}>} */
        const ends = member.suffix === null ? [...S].map(([k, e]) => ({ row: e.row, checks: e.checks, meta: /** @type {TargetMeta} */ ({ kind: 'S', key: k }) })) : []
        if (member.suffix !== null) {
          for (const [k, { end }] of /** @type {Map<string, {end: JunctionEnd & {checks: Check[]}}>} */ (circ.S.get(member.suffix))) {
            ends.push({ row: /** @type {Float64Array} */ (end.row), checks: end.checks, meta: { kind: 'circS', suffix: member.suffix, key: k } })
          }
        }
        for (const e of ends) {
          const checks = member.endChecks.length ? [...e.checks, ...member.endChecks] : e.checks
          const t = targetFor(checks, e.meta)
          const endRow = /** @type {Float64Array} */ (e.row)
          for (let x = 0; x <= m; x++) if (v.ends(x)) t.row[x] = Math.min(t.row[x], member.cost + endRow[original(x)])
          t.sources.push({ member, endRow, meta: e.meta })
        }
        if (member.suffix === null && v.ends(m)) {
          const t = targetFor(member.endChecks, { kind: 'word' })
          t.word ??= new Float64Array(m + 1).fill(Infinity)
          t.word[m] = Math.min(t.word[m], member.cost)
          t.sources.push({ member, endRow: null, meta: { kind: 'word' } })
        }
      }
      const targets = [...byKey.values()]
      const first = members[0]
      const startChecks = v.opChecks.start.length ? [...v.startChecks, ...v.opChecks.start] : v.startChecks
      variants.push({
        ...v,
        op: first.op,
        circumfix: first.circumfix,
        suffix: first.suffix,
        members,
        ...(members.length > 1 ? { options: members.map((x) => x.op) } : {}),
        targets: targets.map((t) => t.meta),
        sources: targets.map((t) => t.sources),
      })
      channels.push({
        query: v.chars,
        options: {
          maxDistance,
          cutoff,
          from: { row: from, pending: [] },
          startEdge: v.startEdge,
          checks: startChecks,
          to: toOption(targets.map(({ sources: _sources, ...t }) => t)),
        },
      })
    }
    return { query, chars, prefixLevels, suffixLevels, P, S, circ, variants, channels, cutoff, truncated }
  }

  /**
   * 走訪之前先給相對上限一個起點：詞幹與查詢的一段完全相同、兩側直接接上已算好的詞綴各層，
   * 這是一個真的分析，所以它的成本（含條件的懲罰）不小於最後的最佳（上限只會更緊、結果不變）。
   * 只查 idx 裡的詞：走訪的是哪個詞庫，就只能用哪個詞庫的詞當起點。
   * @template {Prepared | null} T
   * @param {T} prepared（null 原樣傳回，方便接在 prepare 之後）
   * @param {FuzzyIndex} [idx] 接下來要走訪的詞庫（預設是建立時的詞庫）
   * @returns {T}
   */
  function seed(prepared, idx = index) {
    if (!prepared) return prepared
    const { chars, P, S, cutoff } = prepared
    const n = chars.length
    // 起點：詞首（沒有前綴，一定要有後綴），或前綴狀態的每一類；詞尾：後綴鏈的每一類，或（有前綴時）就是詞尾
    /** @type {Array<{row: Float64Array | null, checks: Check[]}>} */
    const starts = [{ row: null, checks: [] }, ...[...P.values()].map((L) => ({ row: L.row, checks: L.checks }))]
    const ends = [...S.values()]
    for (let x = 0; x + spec.minStem <= n; x++) {
      for (const st of starts) {
        const startCost = st.row === null ? (x === 0 ? 0 : Infinity) : st.row[x]
        if (startCost === Infinity) continue
        let term = chars.slice(x, x + spec.minStem - 1).join('')
        for (let y = x + spec.minStem; y <= n; y++) {
          term += chars[y - 1]
          const stem = chars.slice(x, y)
          let endCost = st.row !== null && y === n ? 0 : Infinity
          for (const e of ends) {
            if (e.row[y] === Infinity) continue
            const c = e.row[y] + (e.checks.length ? penaltyOn(e.checks, [...stem].reverse()) : 0)
            if (c < endCost) endCost = c
          }
          const cost = startCost + (st.checks.length ? penaltyOn(st.checks, stem) : 0) + endCost
          if (cost < cutoff.best && term !== prepared.query && idx.dawg.lookup(term) !== -1) cutoff.best = cost
        }
      }
    }
    return prepared
  }

  /**
   * 一格（交界列的第 x 格，或跨界狀態 node 的第 x 格）的 tag。
   * @param {{tags?: {row: unknown[], pending: Map<any, unknown[]>}}} state
   * @param {Entry} entry
   * @param {unknown} [key] 跨界狀態的鍵（預設 entry.node）
   */
  const tagAt = (state, entry, key) => {
    if (entry.kind === 'start') return null
    if (entry.kind === 'row') return state.tags?.row[entry.x] ?? null
    return state.tags?.pending.get(key ?? entry.node)?.[entry.x] ?? null
  }

  /**
   * 由某一層某一類的一格往回追出整條詞綴鏈：這一格記著是哪個詞綴、由前一層的哪一類過來；
   * 在那個詞綴上由前一層那一類出發做一次追蹤 DP，找到它是由哪一格進來的，一直追到詞首（詞尾）。
   * 路徑上的條件懲罰在一個詞綴之內是常數，不影響追蹤的結果。
   * @param {import('./distance.js').WeightedEditDistance} m 距離函式（後綴用鏡像的）
   * @param {Classes[]} list 各層
   * @param {number} s 從第 s 層開始（1 起算）
   * @param {string} key 第 s 層的類別
   * @param {Entry} entry
   * @param {string[]} x 查詢（後綴用反轉的查詢）
   * @param {(form: string) => string[]} charsOf 詞綴的字元（後綴要反轉）
   * @returns {AffixEntry[]} 由外而內
   */
  function chainFrom(m, list, s, key, entry, x, charsOf) {
    /** @type {AffixEntry[]} */
    const out = []
    let at = entry
    let k = key
    for (let lv = s; lv >= 1 && at.kind !== 'start'; lv--) {
      const level = list[lv - 1].get(k)
      const tag = /** @type {{affix: AffixEntry, from: string} | null} */ (level ? tagAt(level, at) : null)
      if (!tag) break
      out.push(tag.affix)
      const t = m.traceSegment(x, charsOf(tag.affix.form), { from: lv >= 2 ? (list[lv - 2].get(tag.from) ?? null) : null, lock: true, exit: at })
      at = t.entry
      k = tag.from
    }
    return out.reverse()
  }

  /**
   * 命中是由哪些詞綴來的：在詞幹上做一次追蹤 DP（與走訪同一個起點與耦合對象），得到它由起點的哪一格
   * 進來、在耦合對象的哪一格出去，再各自往回追出詞綴鏈。
   * @param {Prepared} prepared
   * @param {number} c 通道
   * @param {SearchResult} result 這個通道走訪到的結果（帶著耦合的出口）
   */
  function affixesOf(prepared, c, result) {
    const v = prepared.variants[c]
    const options = prepared.channels[c].options
    const exitTo = result.exit?.to ?? 0
    const target = /** @type {Target} */ (Array.isArray(options.to) ? options.to[exitTo] : options.to)
    // 「接在前綴之後」與前綴式環綴的通道不知道詞幹從哪一格進來，要在詞幹上做一次追蹤 DP；其他通道的起點
    // 是詞首或固定的位置，出口走訪時已經記下（與追蹤 DP 的結果相同，所以不必再算）
    const t =
      v.kind === 'prefix' || v.kind === 'circumfix' || !result.exit
        ? metric.traceSegment(v.chars, Array.from(result.term), {
            from: options.from ?? null,
            startEdge: options.startEdge,
            exit: { kind: 'couple', to: target },
          })
        : { entry: /** @type {Entry} */ ({ kind: 'start' }), exit: result.exit }
    // 詞綴鏈只取決於（哪一側、第幾層、哪一類、從哪一格往回追），同一次查詢的命中常常共用，所以備忘在 prepared 上
    const memo = (prepared.chains ??= new Map())
    /** @param {string} side @param {number} level @param {string} key @param {Entry} at @param {() => AffixEntry[]} compute */
    const chain = (side, level, key, at, compute) => {
      const k = `${side}|${level}|${key}|${at.kind}|${'x' in at ? at.x : ''}|${'node' in at ? at.node : ''}`
      let out = memo.get(k)
      if (!out) memo.set(k, (out = compute()))
      return out.slice()
    }
    /** 由合併後的前綴狀態（某一類）的一格往回追出前綴鏈 @param {Entry} at @param {string} key */
    const prefixChain = (at, key) => {
      if (at.kind === 'start') return []
      const merged = prepared.P.get(key)
      const tag = /** @type {{level: number, from: string} | null} */ (merged ? tagAt(merged, at) : null)
      if (!tag) return []
      return chain('p', tag.level, key, at, () => chainFrom(metric, prepared.prefixLevels, tag.level, key, at, prepared.chars, (f) => Array.from(f)))
    }
    const reversed = [...prepared.chars].reverse()
    /** 由各層後綴（鏡像座標）某一類的一格往回追出後綴鏈 @param {Entry} at @param {number} level @param {string} key */
    const suffixChain = (at, level, key) =>
      chain('s', level, key, at, () => chainFrom(mirror, prepared.suffixLevels, level, key, at, reversed, (f) => Array.from(f).reverse()))

    /** @type {AffixEntry[]} */
    let prefixes
    /** 這個命中用的非串接步驟或環綴（opChecks：單獨的中綴、重疊自己的條件；環綴的條件在 circumfix.checks） */
    let op = v.op
    let circumfix = v.circumfix
    let suffix = v.suffix
    let opChecks = /** @type {{start: Check[], end: Check[]} | null} */ (/** @type {any} */ (v).opChecks ?? null)
    /** 詞尾接的是哪一類 @type {TargetMeta} */
    let meta = /** @type {TargetMeta[]} */ (v.targets)[exitTo]
    const n = prepared.chars.length
    if (v.members) {
      // 共用通道的變體：出口的成本是哪一個步驟、哪一類給的（同分取先列的，也就是單獨的步驟）
      const exit = /** @type {any} */ (t.exit)
      const x = exit.x > v.cut ? exit.x + v.len : exit.x
      let best = Infinity
      for (const source of /** @type {NonNullable<Variant['sources']>} */ (v.sources)[exitTo]) {
        let cost = Infinity
        if (exit.kind === 'word') cost = source.endRow === null ? source.member.cost : Infinity
        else if (source.endRow !== null) cost = source.member.cost + source.endRow[x]
        if (cost < best) {
          best = cost
          ;({ op, circumfix, suffix } = source.member)
          opChecks = source.member.opChecks ?? null
          meta = source.meta
        }
      }
    }
    if (v.kind === 'circumfix') {
      // 詞幹由合併後的起點進來：那一格的 tag 是哪一個環綴、左邊的哪一類；左邊的狀態再記著它是從詞首（0）
      // 還是從前綴鏈（哪一類）之後（1）走過來的
      const tag = /** @type {{circ: Circumfix, from: string}} */ (tagAt(/** @type {Level} */ (v.startState), t.entry))
      circumfix = tag.circ
      op = /** @type {MorphStepHit} */ (circumfixStep(circumfix, circumfix.left))
      const Pc = /** @type {Level} */ (prepared.circ.P.get(circumfix.left)?.get(tag.from))
      const origin = /** @type {{origin: number, from: string} | null} */ (tagAt(Pc, t.entry))
      if (origin?.origin === 1) {
        const back = metric.traceSegment(prepared.chars, Array.from(circumfix.left), { from: prepared.P.get(origin.from) ?? null, lock: true, exit: t.entry })
        prefixes = prefixChain(back.entry, origin.from)
      } else prefixes = []
    } else {
      // 變體的起點固定在 v.start（有前綴鏈時由合併後的前綴狀態那一類的那一格往回追）
      const key = v.startKey ?? ''
      prefixes = prefixChain(v.start >= 0 ? (v.prefixed ? { kind: 'row', x: v.start } : { kind: 'start' }) : t.entry, key)
    }

    // 後綴：出口換成反向座標（位置 x → n − x；跨界狀態的 tail 反轉後是鏡像 trie 的節點）
    const exit = t.exit
    /** @type {AffixEntry[]} */
    let suffixes = []
    if ((exit.kind === 'row' || exit.kind === 'pending') && meta.kind !== 'word') {
      const x = exit.x > v.cut ? exit.x + v.len : exit.x
      /** @type {Entry} */
      const back =
        exit.kind === 'row'
          ? { kind: 'row', x: n - x }
          : { kind: 'pending', node: mirror.compiled.trieWalk(0, [...target.pending[/** @type {any} */ (exit).tail].tail].reverse()), x: n - x }
      if (meta.kind === 'circS') {
        // 環綴的後綴（那一類）：它的狀態記著是從詞尾（0）還是從後綴鏈（哪一類）之前（1）走過來的
        const Sc = /** @type {{mirror: Level}} */ (prepared.circ.S.get(meta.suffix)?.get(meta.key))
        const origin = /** @type {{origin: number, from: string} | null} */ (tagAt(Sc.mirror, back))
        if (origin?.origin === 1) {
          const from = /** @type {Level} */ (prepared.circ.Sm.get(origin.from))
          const e = mirror.traceSegment(reversed, Array.from(/** @type {string} */ (meta.suffix)).reverse(), { from, lock: true, exit: back })
          if (e.entry.kind !== 'start') {
            const lv = /** @type {{level: number} | null} */ (tagAt(from, e.entry))
            suffixes = suffixChain(e.entry, lv?.level ?? 0, origin.from)
          }
        }
      } else {
        const end = /** @type {ReturnType<typeof emptyEnd>} */ (prepared.S.get(meta.key))
        const tag =
          exit.kind === 'row'
            ? /** @type {{level: number} | null} */ (end.tags.row[x])
            : /** @type {{level: number} | null} */ (end.tags.pending.get(target.pending[/** @type {any} */ (exit).tail].tail.join(''))?.[x] ?? null)
        suffixes = suffixChain(back, tag?.level ?? 0, meta.key)
      }
    }
    return { prefixes, suffixes, op, circumfix, opChecks: circumfix ? null : opChecks }
  }

  /**
   * 一個分析的條件懲罰，直接在具體的字串上讀（與走訪時分類計算的結果相同；說明與測試用）：
   * 前綴讀它之後的前綴、環綴的左邊與詞根，後綴倒著讀它之前的後綴、環綴的右邊與詞根，
   * 環綴與詞根上的中綴、重疊讀詞根（docs/morph-grammar.md 2.7）。
   * @param {{prefixes: AffixEntry[], suffixes: AffixEntry[], circumfix: Circumfix | null, opChecks: {start: Check[], end: Check[]} | null}} a
   * @param {string} term 詞根
   * @returns {{total: number, violations: import('./grammar/compile.js').Violation[]}}
   */
  function analysisPenalty({ prefixes, suffixes, circumfix, opChecks }, term) {
    const t = Array.from(term)
    const left = circumfix?.kind === 'prefix' ? Array.from(circumfix.left) : []
    const right = circumfix?.suffix ? Array.from(circumfix.suffix) : []
    /** @type {import('./grammar/compile.js').Violation[]} */
    const violations = []
    let total = 0
    prefixes.forEach((a, j) => {
      if (a.checks?.start.length) total += penaltyOn(a.checks.start, [...Array.from(prefixes.slice(j + 1).map((b) => b.form).join('')), ...left, ...t], violations)
    })
    const inner = [...suffixes].reverse() // 由內而外（詞中的順序）
    inner.forEach((a, j) => {
      if (a.checks?.end.length) total += penaltyOn(a.checks.end, [...t, ...right, ...Array.from(inner.slice(0, j).map((b) => b.form).join(''))].reverse(), violations)
    })
    const own = circumfix?.checks ?? opChecks
    if (own) total += penaltyOn(own.start, t, violations) + penaltyOn(own.end, [...t].reverse(), violations)
    return { total, violations }
  }

  /**
   * 構詞搜尋的第二步：整理各通道的結果，每個詞取最小成本，並找出是哪些詞綴。
   * @param {Prepared} prepared
   * @param {SearchResult[][]} resultsPerChannel 與 prepared.channels 對應
   * @param {number} maxDistance 總成本上限
   * @returns {MorphHit[]} 依成本排序（同分依詞），只保留「最佳 ＋ lemmaSpread」之內
   */
  function finish(prepared, resultsPerChannel, maxDistance) {
    const { query } = prepared
    /** @type {Map<string, {distance: number, channel: number, result: SearchResult}>} */
    const best = new Map()
    prepared.channels.forEach((_, c) => {
      for (const r of resultsPerChannel[c] ?? []) {
        if (r.term === query || Array.from(r.term).length < spec.minStem || r.distance > maxDistance + EPSILON) continue
        const prev = best.get(r.term)
        if (!prev || r.distance < prev.distance - EPSILON) best.set(r.term, { distance: r.distance, channel: c, result: r })
      }
    })
    const sorted = [...best.values()].sort((a, b) => a.distance - b.distance || (a.result.term < b.result.term ? -1 : 1))
    if (sorted.length === 0) return []
    const cutoff = sorted[0].distance + spec.lemmaSpread + EPSILON
    return sorted
      .filter((h) => h.distance <= cutoff)
      .map((h) => {
        const found = affixesOf(prepared, h.channel, h.result)
        const { prefixes, suffixes, op, circumfix } = found
        /** @type {MorphStepHit[]} */
        const steps = [...prefixes.map((a) => affixStep('prefix', a)), ...(op ? [op] : []), ...suffixes.map((a) => affixStep('suffix', a))]
        // 不成立的條件的懲罰（文法寫法才可能有；平面清單寫法沒有這個欄位，結果與舊版相同）
        const { total, violations } = conditioned ? analysisPenalty(found, h.result.term) : { total: 0, violations: [] }
        const penalty = roundCost(total)
        return {
          term: h.result.term,
          payloads: h.result.payloads,
          distance: roundCost(h.distance),
          steps,
          ...(penalty > 0 ? { penalty, violations } : {}),
          analysis: { variant: h.channel, prefixes, suffixes, circumfix },
        }
      })
  }

  /**
   * 命中的完整說明：整個詞的聯合對齊（metric.explainSegments），各詞素依序接起來，
   * 變體的交界固定在查詢的位置上。對齊的距離加上步驟成本就是命中的成本（測試逐一比對）。
   * @param {Prepared} prepared
   * @param {MorphHit} hit
   */
  function explainHit(prepared, hit) {
    const v = prepared.variants[hit.analysis.variant]
    const { prefixes, suffixes, circumfix } = hit.analysis
    /** @param {'prefix' | 'suffix'} type @param {string} form */
    const affix = (type, form) => ({ chars: Array.from(form), lock: true, type, form })
    // 環綴緊貼詞幹：前綴式的左邊是最內層的前綴，後綴是最內層的後綴（中綴、重疊式的左邊在詞幹上，變體已經拿掉）
    const inner = circumfix?.kind === 'prefix' ? [affix('prefix', circumfix.left)] : []
    /** @type {Array<{chars: string[], lock: boolean, type: 'prefix' | 'stem' | 'suffix', form: string}>} */
    const segments = [
      ...prefixes.map((a) => affix('prefix', a.form)),
      ...inner,
      { chars: Array.from(hit.term), lock: false, type: /** @type {const} */ ('stem'), form: hit.term },
      ...(circumfix?.suffix ? [affix('suffix', circumfix.suffix)] : []),
      // 後綴由外而內，在詞中的順序要反過來
      ...[...suffixes].reverse().map((a) => affix('suffix', a.form)),
    ]
    const stem = prefixes.length + inner.length
    /** @type {Parameters<typeof metric.explainSegments>[2]} */
    const options = {}
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
   * @param {Prepared} prepared
   * @param {MorphHit} hit
   * @returns {Array<{op: string, source: string, target: string, cost: number, category: string | null, where: 'prefix' | 'stem' | 'suffix' | 'junction'}>}
   */
  function notesOf(prepared, hit) {
    const { query, segments, explanation } = explainHit(prepared, hit)
    return notesFrom(query, segments, explanation)
  }

  /**
   * 任意一組詞素的音變說明（衍生形方向，以及類 pika 剖析器的命中）：整個詞的聯合對齊，標出每一步落在哪裡。
   * @param {string[]} x 查詢（衍生形方向是衍生詞本身）
   * @param {Array<{chars: string[], lock: boolean, type: 'prefix' | 'stem' | 'suffix'}>} segments
   * @param {Parameters<typeof metric.explainSegments>[2]} [options] 還原變體的固定交界（chart 命中的 trace.options）
   */
  function notesFor(x, segments, options) {
    return notesFrom(x, segments, metric.explainSegments(x, segments, options))
  }

  /**
   * @param {string[]} _x
   * @param {Array<{type: 'prefix' | 'stem' | 'suffix'}>} segments
   * @param {ReturnType<typeof metric.explainSegments>} explanation
   */
  function notesFrom(_x, segments, explanation) {
    const junctions = new Set(explanation.junctions)
    const typeAt = (/** @type {number} */ j) => segments[explanation.segmentOf[j]]?.type ?? 'stem'
    return explanation.alignment
      .filter((s) => s.op !== 'match')
      .map((s) => {
        const [, b0] = s.from
        const [, b] = s.to
        /** @type {'prefix' | 'stem' | 'suffix' | 'junction'} */
        let where
        if (b0 === b) where = junctions.has(b) ? 'junction' : typeAt(Math.max(0, b - 1))
        else where = explanation.segmentOf[b0] === explanation.segmentOf[b - 1] ? typeAt(b0) : 'junction'
        return { op: s.op, source: s.source, target: s.target, cost: s.cost, category: s.rule?.category ?? null, where }
      })
  }

  /**
   * 衍生形方向：詞 word 能否分析成「詞綴 · stem · 詞綴」——同一個 BCDP，詞庫只有 stem 一個詞。
   * @param {string} word 已正規化的詞（衍生形的候選）
   * @param {string} stem 已正規化的詞根
   * @param {number} maxDistance 總成本上限
   * @returns {{hit: MorphHit, prepared: Prepared} | null}
   */
  function derive(word, stem, maxDistance) {
    const prepared = prepare(word, maxDistance)
    if (!prepared || word === stem) return null
    const single = new FuzzyIndex(metric).addAll([[stem, null]])
    const hit = finish(prepared, single.searchChannels(prepared.channels), maxDistance).find((h) => h.term === stem)
    return hit ? { hit, prepared } : null
  }

  /**
   * 構詞搜尋（單獨執行；搜尋引擎則把通道與普通模糊搜尋合併成一次走訪）。
   * @param {string} query 已正規化的查詢（搜尋鍵）
   * @param {{maxDistance: number, stats?: {visitedNodes: number}}} options
   * @returns {MorphHit[]}
   */
  function search(query, { maxDistance, stats }) {
    const prepared = prepare(query, maxDistance)
    if (!prepared) return []
    const local = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    const results = index.searchChannels(seed(prepared).channels, local)
    if (stats) stats.visitedNodes += local.visitedNodes
    return finish(prepared, results, maxDistance)
  }

  /**
   * 說明一次構詞搜尋：各階段的中間結果，給演算法實驗室逐步展示（docs/lab-design.md）。
   * 與 search 走同一套程式，所以 hit 一定等於搜尋對這個詞的結果（測試逐一比對）。
   * 回傳值只含可以結構化複製的資料，∞ 寫成 null，可以從 Web Worker 傳回。
   * @param {string} query 已正規化的查詢（搜尋鍵）
   * @param {string | null} [term] 要說明的詞根（省略時只列出命中）
   * @param {{maxDistance?: number}} [options] 總成本上限（與 search 相同）
   */
  function explain(query, term = null, { maxDistance = 1 } = {}) {
    const chars = Array.from(query)
    const n = chars.length
    const params = { maxSteps: spec.maxSteps, minStem: spec.minStem, lemmaSpread: spec.lemmaSpread, maxDistance }
    const prepared = prepare(query, maxDistance)
    if (!prepared) return { query, chars, params, tooShort: true, term, reason: term === null ? null : 'short' }
    /** @type {Array<Array<Record<string, unknown>>>} */
    const walks = prepared.channels.map(() => [])
    seed(prepared)
    const results = index.searchChannels(
      prepared.channels.map((ch, c) => ({ query: ch.query, options: { ...ch.options, onNode: (/** @type {any} */ e) => walks[c].push(e) } })),
    )
    // 命中的 analysis 引用詞綴清單的項目，文法寫法的項目帶著條件的 DFA（函式）：
    // 回傳值要能結構化複製（由 Web Worker 傳回），所以拿掉 checks
    const hits = finish(prepared, results, maxDistance).map(publicHit)
    const cutoff = hits.length ? roundCost(hits[0].distance + spec.lemmaSpread) : null
    const finite = (/** @type {number} */ x) => (x === Infinity ? null : roundCost(x))
    const rowOf = (/** @type {ArrayLike<number>} */ row) => Array.from(row, finite)

    /** @type {MorphHit | null} */
    let hit = null
    /** @type {Record<string, unknown> | null} */
    let alignment = null
    /** 找不到 term 的原因 @type {string | null} */
    let reason = null
    if (term !== null) {
      hit = hits.find((h) => h.term === term) ?? null
      if (hit) {
        const x = explainHit(prepared, hit)
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
      else {
        // 走訪用了相對上限，被截斷的詞可能根本沒走到：只對這個詞、不收緊上限再算一次
        const single = new FuzzyIndex(metric).addAll([[term, null]])
        const alone = single.searchChannels(prepared.channels.map((ch) => ({ query: ch.query, options: { ...ch.options, cutoff: undefined } })))
        reason = alone.flat().length ? 'spread' : 'bound'
      }
    }
    return {
      query,
      chars,
      params,
      tooShort: false,
      // 各層、合併後的狀態依條件分類；實驗室顯示每一格在各類中的最小值（沒有條件時只有一類）
      prefixLevels: prepared.prefixLevels.map((classes) => rowOf(minRow([...classes.values()].map((L) => L.row), n))),
      suffixLevels: prepared.suffixLevels.map((classes) => rowOf(minRow([...classes.values()].map((L) => L.row), n).reverse())),
      merged: {
        P: rowOf(minRow([...prepared.P.values()].map((L) => L.row), n)),
        S: rowOf(minRow([...prepared.S.values()].map((E) => /** @type {Float64Array} */ (E.row)), n)),
        crossingP: [...prepared.P.values()].flatMap((L) => L.pending.map((p) => ({ head: metric.compiled.trieString(p.node), row: rowOf(p.row) }))),
        crossingS: [...prepared.S.values()].flatMap((E) => E.pending.map((p) => ({ tail: p.tail.join(''), row: rowOf(p.row) }))),
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
      })),
      truncated: prepared.truncated,
      candidates: results.map((list) => list.map((r) => ({ term: r.term, distance: r.distance, exit: r.exit ?? null }))),
      walks: walks.map((events) => events.map((e) => ({ ...e, lowerBound: finite(/** @type {number} */ (e.lowerBound)) }))),
      hits,
      cutoff,
      term,
      hit,
      alignment,
      reason,
    }
  }

  return {
    search,
    prepare,
    seed,
    finish,
    explain,
    explainHit,
    notesOf,
    notesFor,
    derive,
    /** 一個分析的條件懲罰與不成立的條件（衍生形方向用；規格沒有條件時一律是 0） */
    penaltyOf: /** @type {typeof analysisPenalty} */ ((a, term) => (conditioned ? analysisPenalty(a, term) : { total: 0, violations: [] })),
    clearCache: () => cache.clear(),
  }
}

/**
 * 可以結構化複製的命中：analysis 中的詞綴清單項目拿掉 checks（條件的 DFA 是函式）。
 * @param {MorphHit} h
 * @returns {MorphHit}
 */
function publicHit(h) {
  const strip = (/** @type {any} */ e) => {
    if (!e?.checks) return e
    const { checks: _checks, ...rest } = e
    return rest
  }
  return { ...h, analysis: { ...h.analysis, prefixes: h.analysis.prefixes.map(strip), suffixes: h.analysis.suffixes.map(strip), circumfix: strip(h.analysis.circumfix) } }
}

/**
 * 幾列逐項取 min（沒有任何列時全是 ∞）。
 * @param {ArrayLike<number>[]} rows
 * @param {number} n 查詢長度
 */
function minRow(rows, n) {
  const out = new Float64Array(n + 1).fill(Infinity)
  for (const row of rows) for (let x = 0; x <= n; x++) if (row[x] < out[x]) out[x] = row[x]
  return out
}

/**
 * 超過上限的格子設成 ∞（之後的成本只會增加，它們不可能成為命中的一部分），全是 ∞ 的跨界狀態丟掉。
 * @param {Level} level
 * @param {number} bound
 */
function clip(level, bound) {
  const cut = (/** @type {Float64Array} */ row) => {
    for (let x = 0; x < row.length; x++) if (row[x] > bound + EPSILON) row[x] = Infinity
  }
  cut(level.row)
  for (const p of level.pending) cut(p.row)
  level.pending = level.pending.filter((p) => p.row.some((v) => v < Infinity))
}

/**
 * @param {'prefix' | 'suffix'} type
 * @param {AffixEntry} a
 * @returns {MorphStepHit}
 */
function affixStep(type, a) {
  // 文法寫法的項目帶著由哪些詞素構成（說明用）；平面清單寫法沒有，結果與舊版相同
  if (a.parts) return { type, form: a.form, gloss: a.gloss, cost: a.cost, parts: a.parts, ...(a.unattested ? { unattested: true } : {}), ...(a.violations ? { violations: a.violations } : {}) }
  return { type, form: a.form, gloss: a.gloss, cost: a.cost }
}
