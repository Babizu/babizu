/**
 * @file 構詞文法的規格：驗證與正規化（docs/morph-grammar.md 第 2、3 節）。
 *
 * 語言設定檔的 `morphology` 有兩種寫法：
 * - **文法**：`morphemes`（詞素與同位詞素、條件）與 `constructions`（組合規則）
 * - **平面清單**（舊的寫法）：`prefixes`、`suffixes`、`infixes`、`reduplication`、`circumfixes`
 *
 * 兩種寫法都正規化成同一個 {@link Grammar}：平面清單的每一項是一個詞素（一個同位詞素、沒有條件），
 * 每個環綴是一條組合規則。之後的編譯（compile.js）、BCDP、類 pika 剖析器都只看 Grammar。
 *
 * 可停止性的前提在這裡檢查（docs/morph-grammar.md 第 4 節）：同位詞素非空、重疊模板一定產生字元、
 * 條件屬於受限子集、`maxUses` 與 `maxSteps` 有上限、組合規則只引用存在的詞素且形狀受支援。
 */

import { compileCondition } from './conditions.js'

/** @typedef {import('../morphology.js').Gloss} Gloss */
/** @typedef {import('../morphology.js').ReduplicationPattern} ReduplicationPattern */
/** @typedef {import('./conditions.js').Condition} Condition */

/** 支援的重疊型式（與 morphology.js 相同；放在這裡避免循環引用） */
export const PATTERNS = Object.freeze(['Ca', 'CV', 'CVV', 'CVCV', 'CVCVC', 'full'])
export const MORPHEME_TYPES = Object.freeze(['prefix', 'suffix', 'infix', 'reduplication'])

/** 預設值（未指定時）：與 docs/morph-grammar.md 第 8 節的決定相同 */
export const GRAMMAR_DEFAULTS = Object.freeze({
  cost: 0.3,
  minStem: 3,
  maxSteps: 3,
  lemmaSpread: 0.6,
  vowels: 'aeiouéə',
  unattestedPenalty: 0.2,
  conditionPenalty: 0.3,
})

/** maxSteps 的上限（與 morphology.js 相同） */
export const MAX_STEPS_LIMIT = 10
/** 一個詞素在一個推導中最多用幾次 */
export const MAX_USES_LIMIT = 3

const LEGACY_KEYS = ['prefixes', 'suffixes', 'infixes', 'reduplication', 'circumfixes']
const GRAMMAR_KEYS = ['morphemes', 'constructions', 'unattestedPenalty', 'conditionPenalty']
const COMMON_KEYS = ['cost', 'minStem', 'maxSteps', 'lemmaSpread', 'vowels', 'alternations']
const MORPHEME_KEYS = new Set(['id', 'type', 'form', 'pattern', 'when', 'allomorphs', 'gloss', 'cost', 'maxUses', 'free', 'ref', 'note'])
const ALLOMORPH_KEYS = new Set(['form', 'pattern', 'when', 'ref', 'note'])
const CONSTRUCTION_KEYS = new Set(['id', 'sequence', 'gloss', 'cost', 'ref', 'note'])

/**
 * @typedef {object} Allomorph 同位詞素
 * @property {string} form 詞綴的形式（已正規化）；重疊是空字串
 * @property {ReduplicationPattern | null} pattern 重疊的型式
 * @property {Condition | null} condition 條件（編譯後）
 */

/**
 * @typedef {object} Morpheme 詞素
 * @property {string} id
 * @property {'prefix' | 'suffix' | 'infix' | 'reduplication'} type
 * @property {Gloss} gloss
 * @property {number} cost
 * @property {number} maxUses
 * @property {boolean} free 可以不在組合規則中單獨使用
 * @property {Allomorph[]} allomorphs
 */

/**
 * @typedef {object} Construction 組合規則：依推導順序套用的詞素，合起來算一個步驟
 * @property {string} id
 * @property {string[]} sequence 詞素 id（推導順序，由內而外）
 * @property {Gloss} gloss
 * @property {number} cost
 */

/**
 * @typedef {object} Grammar 正規化後的構詞文法
 * @property {'grammar' | 'legacy'} source 規格原本的寫法（平面清單編譯時不加 parts，結果與舊版逐位元相同）
 * @property {number} cost
 * @property {number} minStem
 * @property {number} maxSteps
 * @property {number} lemmaSpread
 * @property {string} vowels
 * @property {number} unattestedPenalty
 * @property {number} conditionPenalty
 * @property {Morpheme[]} morphemes
 * @property {Map<string, Morpheme>} byId
 * @property {Construction[]} constructions
 * @property {Array<{underlying: string, surface: string, position: 'final' | 'initial' | 'any', cost: number}>} alternations
 */

/** 規格是不是文法的寫法 @param {any} spec */
export const isGrammarSpec = (spec) => Boolean(spec && typeof spec === 'object' && GRAMMAR_KEYS.some((k) => spec[k] !== undefined))

const hasSpace = (/** @type {string} */ s) => /\s/u.test(s)
const isCost = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

/**
 * 驗證文法寫法的規格（平面清單由 morphology.js 的 validateMorphology 驗證）。
 * 回傳錯誤訊息清單；空陣列表示沒有錯誤。
 * @param {Record<string, any>} s
 * @returns {string[]}
 */
export function validateGrammar(s) {
  const errors = []
  const mixed = LEGACY_KEYS.filter((k) => s[k] !== undefined)
  if (mixed.length) errors.push(`morphology 不能同時使用文法（morphemes、constructions）與平面清單（${mixed.join('、')}）；請改寫成詞素`)
  for (const key of Object.keys(s)) {
    if (![...GRAMMAR_KEYS, ...COMMON_KEYS, ...LEGACY_KEYS].includes(key)) errors.push(`morphology.${key} 是未知的欄位`)
  }
  for (const key of ['unattestedPenalty', 'conditionPenalty']) {
    if (s[key] !== undefined && !isCost(s[key])) errors.push(`morphology.${key} 必須是非負的有限數`)
  }
  const vowels = typeof s.vowels === 'string' && s.vowels ? s.vowels : GRAMMAR_DEFAULTS.vowels

  /** @type {Map<string, string>} 詞素 id → 類型 */
  const types = new Map()
  /** @type {Map<string, number>} 詞素 id → maxUses */
  const uses = new Map()
  if (!Array.isArray(s.morphemes)) errors.push('morphology.morphemes 必須是陣列')
  else {
    s.morphemes.forEach((/** @type {any} */ m, /** @type {number} */ i) => {
      const path = `morphology.morphemes[${i}]`
      if (!m || typeof m !== 'object') return errors.push(`${path} 必須是物件`)
      for (const key of Object.keys(m)) if (!MORPHEME_KEYS.has(key)) errors.push(`${path}.${key} 是未知的欄位`)
      if (typeof m.id !== 'string' || !m.id || hasSpace(m.id) || m.id.includes('|')) errors.push(`${path}.id 必須是不含空白與 | 的非空字串`)
      else if (types.has(m.id)) errors.push(`${path}.id「${m.id}」重複`)
      if (!MORPHEME_TYPES.includes(m.type)) errors.push(`${path}.type 必須是 ${MORPHEME_TYPES.join('、')} 之一`)
      if (m.cost !== undefined && !isCost(m.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
      if (m.maxUses !== undefined && !(Number.isInteger(m.maxUses) && m.maxUses >= 1 && m.maxUses <= MAX_USES_LIMIT)) {
        errors.push(`${path}.maxUses 必須是 1–${MAX_USES_LIMIT} 的整數`)
      }
      if (m.free !== undefined && typeof m.free !== 'boolean') errors.push(`${path}.free 必須是 true 或 false`)
      if (typeof m.id === 'string') {
        types.set(m.id, m.type)
        uses.set(m.id, m.maxUses ?? 1)
      }
      const inline = m.form !== undefined || m.pattern !== undefined || m.when !== undefined
      if (inline && m.allomorphs !== undefined) errors.push(`${path} 不能同時有 allomorphs 與 form／pattern／when`)
      const list = m.allomorphs ?? (inline ? [{ form: m.form, pattern: m.pattern, when: m.when }] : undefined)
      if (!Array.isArray(list) || list.length === 0) return errors.push(`${path} 需要 form（重疊是 pattern），或非空的 allomorphs`)
      list.forEach((/** @type {any} */ a, /** @type {number} */ k) => {
        const apath = m.allomorphs ? `${path}.allomorphs[${k}]` : path
        if (m.allomorphs) for (const key of Object.keys(a ?? {})) if (!ALLOMORPH_KEYS.has(key)) errors.push(`${apath}.${key} 是未知的欄位`)
        if (m.type === 'reduplication') {
          if (!PATTERNS.includes(a?.pattern)) errors.push(`${apath}.pattern 必須是 ${PATTERNS.join('、')} 之一`)
          if (a?.form !== undefined) errors.push(`${apath} 是重疊，用 pattern 而不是 form`)
        } else {
          if (typeof a?.form !== 'string' || !a.form) errors.push(`${apath}.form 必須是非空字串（空的詞素會讓剖析無法停止）`)
          else if (hasSpace(a.form)) errors.push(`${apath}.form 不能含空白（詞綴不跨越詞邊界）`)
          if (a?.pattern !== undefined) errors.push(`${apath} 不是重疊，不能有 pattern`)
        }
        if (a?.when !== undefined) {
          try {
            const cond = compileCondition(a.when, { vowels })
            const want = m.type === 'suffix' ? 'end' : 'start'
            if (cond.side !== want) errors.push(`${apath}.when「${a.when}」的錨點不對：${m.type === 'suffix' ? '後綴看基底結尾，要以 $ 結尾' : '前綴、中綴、重疊看基底開頭，要以 ^ 開頭'}`)
          } catch (e) {
            errors.push(`${apath}.when：${/** @type {Error} */ (e).message}`)
          }
        }
      })
    })
  }

  if (s.constructions !== undefined && !Array.isArray(s.constructions)) errors.push('morphology.constructions 必須是陣列')
  const ids = new Set()
  for (const [i, c] of (Array.isArray(s.constructions) ? s.constructions : []).entries()) {
    const path = `morphology.constructions[${i}]`
    if (!c || typeof c !== 'object') {
      errors.push(`${path} 必須是物件`)
      continue
    }
    for (const key of Object.keys(c)) if (!CONSTRUCTION_KEYS.has(key)) errors.push(`${path}.${key} 是未知的欄位`)
    if (typeof c.id !== 'string' || !c.id || hasSpace(c.id)) errors.push(`${path}.id 必須是不含空白的非空字串`)
    else if (ids.has(c.id) || types.has(c.id)) errors.push(`${path}.id「${c.id}」與其他組合規則或詞素重複`)
    ids.add(c.id)
    if (c.cost !== undefined && !isCost(c.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
    if (!Array.isArray(c.sequence) || c.sequence.length < 2) {
      errors.push(`${path}.sequence 必須是至少兩個詞素 id 的陣列（依推導順序，由內而外）`)
      continue
    }
    const unknown = c.sequence.filter((/** @type {unknown} */ id) => typeof id !== 'string' || !types.has(id))
    if (unknown.length) {
      errors.push(`${path}.sequence 引用了不存在的詞素：${unknown.join('、')}`)
      continue
    }
    const count = new Map()
    for (const id of c.sequence) count.set(id, (count.get(id) ?? 0) + 1)
    for (const [id, n] of count) if (n > /** @type {number} */ (uses.get(id))) errors.push(`${path}.sequence 用了 ${n} 次「${id}」，超過它的 maxUses`)
    const shape = constructionShape(c.sequence.map((/** @type {string} */ id) => /** @type {string} */ (types.get(id))))
    if (shape.error) errors.push(`${path}：${shape.error}`)
  }

  const maxSteps = s.maxSteps ?? GRAMMAR_DEFAULTS.maxSteps
  for (const [i, c] of (Array.isArray(s.constructions) ? s.constructions : []).entries()) {
    if (Array.isArray(c?.sequence) && c.sequence.length > 2 * maxSteps + 1) errors.push(`morphology.constructions[${i}].sequence 太長（至多 2 × maxSteps ＋ 1 ＝ ${2 * maxSteps + 1} 個）`)
  }
  return errors
}

/**
 * 組合規則的形狀（docs/morph-grammar.md 2.4、5.1）：依推導順序，
 * - 詞根上的非串接運算（中綴、重疊）只能是第一個，之後只能接後綴；
 * - 否則是「至少一個前綴，其中至多插入一個中綴（落在前綴上）」，後綴可以穿插在任何位置。
 * 兩種實作（BCDP、類 pika 剖析器）都只支援這些形狀，所以規格驗證時就拒絕其他形狀，兩者的定義才會一致。
 * @param {string[]} types 各詞素的類型（推導順序）
 * @returns {{kind: 'stem' | 'prefix' | 'suffix', error?: string}}
 */
export function constructionShape(types) {
  const first = types[0]
  if (first === 'infix' || first === 'reduplication') {
    const bad = types.slice(1).find((t) => t !== 'suffix')
    if (bad) return { kind: 'stem', error: `詞根上的${first === 'infix' ? '中綴' : '重疊'}之後只能再接後綴（不支援之後再加${bad === 'prefix' ? '前綴' : bad === 'infix' ? '中綴' : '重疊'}）` }
    return { kind: 'stem' }
  }
  if (types.includes('reduplication')) return { kind: 'prefix', error: '組合規則中的重疊只能是第一個（直接加在詞根上）' }
  const infixes = types.filter((t) => t === 'infix').length
  if (infixes > 1) return { kind: 'prefix', error: '組合規則至多一個中綴' }
  if (infixes === 1) {
    const at = types.indexOf('infix')
    if (!types.slice(0, at).includes('prefix')) return { kind: 'prefix', error: '中綴之前至少要有一個前綴（中綴落在前綴上）；直接加在詞根上的中綴要放在第一個' }
  }
  if (!types.includes('prefix')) return { kind: 'suffix', error: '只有後綴的組合規則尚未支援（兩種實作都還沒有；需要時再擴充）' }
  return { kind: 'prefix' }
}

/**
 * 把（已驗證的）規格正規化成 Grammar。平面清單轉成「一項一個詞素、一個環綴一條組合規則」。
 * @param {Record<string, any>} spec
 * @param {(s: string) => string} normalize 詞綴的正規化（與搜尋鍵相同）
 * @returns {Grammar}
 */
export function normalizeGrammar(spec, normalize = (s) => s) {
  const cost = spec.cost ?? GRAMMAR_DEFAULTS.cost
  const vowels = [...new Set(Array.from(normalize(spec.vowels ?? GRAMMAR_DEFAULTS.vowels)))].join('')
  /** 說明複製一份再凍結 @param {Gloss | undefined} g */
  const glossOf = (g) => (g == null ? null : typeof g === 'string' ? g : Object.freeze({ ...g }))
  const base = {
    cost,
    minStem: spec.minStem ?? GRAMMAR_DEFAULTS.minStem,
    maxSteps: spec.maxSteps ?? GRAMMAR_DEFAULTS.maxSteps,
    lemmaSpread: spec.lemmaSpread ?? GRAMMAR_DEFAULTS.lemmaSpread,
    vowels,
    unattestedPenalty: spec.unattestedPenalty ?? GRAMMAR_DEFAULTS.unattestedPenalty,
    conditionPenalty: spec.conditionPenalty ?? GRAMMAR_DEFAULTS.conditionPenalty,
    alternations: (spec.alternations ?? []).map((/** @type {any} */ a) => ({
      underlying: normalize(a.underlying),
      surface: normalize(a.surface),
      position: a.position ?? 'final',
      cost: a.cost ?? cost,
    })),
  }
  /** @type {Morpheme[]} */
  const morphemes = []
  /** @type {Construction[]} */
  const constructions = []

  if (isGrammarSpec(spec)) {
    for (const m of spec.morphemes) {
      const list = m.allomorphs ?? [{ form: m.form, pattern: m.pattern, when: m.when }]
      morphemes.push({
        id: m.id,
        type: m.type,
        gloss: glossOf(m.gloss),
        cost: m.cost ?? cost,
        maxUses: m.maxUses ?? 1,
        free: m.free ?? true,
        allomorphs: list.map((/** @type {any} */ a) => ({
          form: m.type === 'reduplication' ? '' : normalize(a.form),
          pattern: m.type === 'reduplication' ? a.pattern : null,
          condition: a.when === undefined ? null : compileCondition(a.when, { vowels }),
        })),
      })
    }
    for (const c of spec.constructions ?? []) constructions.push({ id: c.id, sequence: [...c.sequence], gloss: glossOf(c.gloss), cost: c.cost ?? cost })
  } else {
    // 平面清單：一項一個詞素（id 由類型與形式組成，重複時加序號），一個環綴一條組合規則，
    // 環綴的兩側是只能在組合規則中使用的詞素（free: false），與舊版的語意相同
    const seen = new Map()
    const idFor = (/** @type {string} */ key) => {
      const n = seen.get(key) ?? 0
      seen.set(key, n + 1)
      return n === 0 ? key : `${key}#${n + 1}`
    }
    /** @param {'prefix' | 'suffix' | 'infix'} type @param {any[]} list */
    const affixes = (type, list) => {
      for (const a of list ?? []) {
        const form = normalize(a.form)
        if (!form) continue // 正規化後變成空字串的詞綴略過（與舊版相同）
        morphemes.push({ id: idFor(`${type}:${form}`), type, gloss: glossOf(a.gloss), cost: a.cost ?? cost, maxUses: 1, free: true, allomorphs: [{ form, pattern: null, condition: null }] })
      }
    }
    affixes('prefix', spec.prefixes)
    affixes('suffix', spec.suffixes)
    affixes('infix', spec.infixes)
    for (const r of spec.reduplication ?? []) {
      morphemes.push({ id: idFor(`reduplication:${r.pattern}`), type: 'reduplication', gloss: glossOf(r.gloss), cost: r.cost ?? cost, maxUses: 1, free: true, allomorphs: [{ form: '', pattern: r.pattern, condition: null }] })
    }
    for (const c of spec.circumfixes ?? []) {
      const kind = c.prefix !== undefined ? 'prefix' : c.infix !== undefined ? 'infix' : 'reduplication'
      const leftForm = kind === 'reduplication' ? '' : normalize(kind === 'prefix' ? c.prefix : c.infix)
      const suffix = normalize(c.suffix)
      if ((kind !== 'reduplication' && !leftForm) || !suffix) continue
      const left = idFor(`circumfix:${kind}:${leftForm || c.reduplication}`)
      morphemes.push({ id: left, type: kind, gloss: null, cost: 0, maxUses: 1, free: false, allomorphs: [{ form: leftForm, pattern: kind === 'reduplication' ? c.reduplication : null, condition: null }] })
      const right = idFor(`circumfix:suffix:${suffix}`)
      morphemes.push({ id: right, type: 'suffix', gloss: null, cost: 0, maxUses: 1, free: false, allomorphs: [{ form: suffix, pattern: null, condition: null }] })
      constructions.push({ id: idFor(`circumfix:${leftForm || c.reduplication}…${suffix}`), sequence: [left, right], gloss: glossOf(c.gloss), cost: c.cost ?? cost })
    }
  }
  return {
    source: isGrammarSpec(spec) ? 'grammar' : 'legacy',
    ...base,
    morphemes,
    byId: new Map(morphemes.map((m) => [m.id, m])),
    constructions,
  }
}
