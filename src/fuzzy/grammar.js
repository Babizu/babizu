/**
 * @file 構詞文法（選用）：詞素與組合規則，載入時展開成平面的詞綴清單（docs/morph-grammar.md）。
 *
 * 搜尋只認得平面清單（前綴、後綴、中綴、重疊、環綴），文法只是寫法：把「最小詞素」與「它們依什麼順序組合」
 * 寫出來，由這裡展開成清單，每一項帶著 parts（由哪些詞素、依推導順序構成），說明時顯示詞素。
 * 展開之後就是一份普通的平面規格，搜尋演算法（BCDP）完全不知道文法的存在。
 *
 * ## 編譯原理：以詞根為符號的推導
 *
 * 一條組合規則是一串詞素（推導順序）。把詞根當成一個不知道內容的符號 X，由 (L, op, R) ＝ (∅, ∅, ∅) 開始依序套用：
 *
 * 1. 前綴 p：L ← p · L
 * 2. 後綴 s：R ← R · s
 * 3. 中綴 x：L 含元音時插在 L 的首輔音（群）之後（mu ＋ <in> → minu）；
 *    L 沒有元音（空的，或只有輔音，例如 m）時，中綴的位置是「L · X」的首輔音之後，也就是 X 的首輔音之後——
 *    它落在詞根上：op ← 中綴 x，L 留在外側（m ＋ <a> ＋ usa ＝ m ＋ ausa ＝ mausa；m ＋ <a> ＋ baket ＝ mbaaket）
 * 4. 重疊：只能是第一個（直接加在詞根上）：op ← 重疊
 *
 * 結果是 L · op(X) · R。沒有 op、只有一側的，是一般的詞綴（可以與其他詞綴串接）；其他的是環綴
 * （緊貼詞根的包覆單位，算一個步驟）。平面清單的環綴因此多了兩種形狀：前綴 ＋ 中綴（m<a>-），
 * 前綴 ＋ 中綴 ＋ 後綴（m<a>-…-ay）。
 *
 * **中綴落在詞根上、外側有前綴時**（L 不空，op 是中綴）：詞根以元音開頭時，中綴就緊接在 L 之後，
 * 表面正好是字串 L·x（m ＋ <a> ＋ usa ＝ ma · usa）。所以另外產生一項「L·x ＋ R，詞根要元音開頭」
 * （stemInitial: 'V'）的前綴式環綴：它是一般的串接，音變規則可以跨越它的交界（usa｜ay → usay 的元音合併）。
 * 詞根以輔音開頭時（m ＋ b<a>aket），由 (L, op, R) 那一項在詞根上還原中綴。兩項表示同一個組合規則，
 * 成本、說明、parts、rank 都相同；「元音開頭」不是另外加的條件，而是中綴位置的定義。
 *
 * **引理**：對任何詞根 r，把序列直接套在 r 上的結果等於 L · op(r) · R。只有第 3 步的第二種情形與 r 的內容有關，
 * 而那正是把中綴交給 op、在 r 上決定位置的情形（test/fuzzy/grammar.test.js 以隨機序列與詞根檢查）。
 *
 * **展開**：每條組合規則的每一種同位詞素選擇各一項（笛卡兒積），有明確的上限；自由的詞素一個形式一項。
 * 清單的順序是「自由詞素（依規格順序）在前，組合規則（依規格順序）在後」，rank 記下這個順序：
 * 成本與步驟數都相同的分析，說明選 rank 較前的（morph-search.js 的 finish）。也就是只有在所有同分的分析
 * 都用到組合規則時，才依組合規則的順序選——與原本的 BCDP 在平面清單上的行為相同。
 */

import { REDUPLICATION_PATTERNS, validateMorphology } from './morphology.js'

/** @typedef {import('./morphology.js').Gloss} Gloss */
/** @typedef {import('./morphology.js').MorphologySpec} MorphologySpec */

/**
 * @typedef {object} Part 展開後的一項由哪個詞素構成（推導順序中的一個）
 * @property {string} id 詞素 id
 * @property {'prefix' | 'suffix' | 'infix' | 'reduplication'} type
 * @property {string} form 形式（重疊是型式）
 * @property {Gloss} gloss
 */

/** 展開後的項目總數上限：超過是規格錯誤（通常是同位詞素很多的詞素出現在很多組合規則裡） */
export const MAX_EXPANDED = 5000

const TYPES = new Set(['prefix', 'suffix', 'infix', 'reduplication'])
/** 文法寫法的頂層欄位；與平面清單共用的欄位（cost、alternations…）由 validateMorphology 檢查 */
const GRAMMAR_KEYS = new Set(['morphemes', 'constructions'])
const SHARED_KEYS = new Set(['cost', 'minStem', 'maxSteps', 'lemmaSpread', 'vowels', 'alternations'])
const MORPHEME_KEYS = new Set(['id', 'type', 'form', 'forms', 'pattern', 'gloss', 'cost', 'free', 'ref', 'note'])
const CONSTRUCTION_KEYS = new Set(['id', 'sequence', 'gloss', 'cost', 'ref', 'note'])
const hasSpace = (/** @type {string} */ s) => /\s/u.test(s)

/**
 * 規格是否用文法寫法（有 morphemes 或 constructions）。
 * @param {unknown} spec
 */
export function isGrammarSpec(spec) {
  return !!spec && typeof spec === 'object' && ('morphemes' in spec || 'constructions' in spec)
}

/**
 * 檢查文法寫法的規格，回傳錯誤訊息清單。與平面清單共用的欄位交給 validateMorphology。
 * @param {Record<string, any>} spec
 * @returns {string[]}
 */
export function validateGrammar(spec) {
  const errors = []
  for (const key of Object.keys(spec)) {
    if (!GRAMMAR_KEYS.has(key) && !SHARED_KEYS.has(key)) {
      errors.push(
        ['prefixes', 'suffixes', 'infixes', 'reduplication', 'circumfixes'].includes(key)
          ? `morphology.${key}：不能同時使用文法寫法（morphemes、constructions）與平面清單寫法`
          : `morphology.${key} 是未知的欄位`,
      )
    }
  }
  errors.push(...validateMorphology(Object.fromEntries(Object.entries(spec).filter(([key]) => SHARED_KEYS.has(key)))))

  const morphemes = Array.isArray(spec.morphemes) ? spec.morphemes : []
  if (spec.morphemes !== undefined && !Array.isArray(spec.morphemes)) errors.push('morphology.morphemes 必須是陣列')
  /** @type {Map<string, any>} */
  const byId = new Map()
  morphemes.forEach((/** @type {any} */ m, /** @type {number} */ i) => {
    const path = `morphology.morphemes[${i}]`
    if (!m || typeof m !== 'object') {
      errors.push(`${path} 必須是物件`)
      return
    }
    for (const key of Object.keys(m)) if (!MORPHEME_KEYS.has(key)) errors.push(`${path}.${key} 是未知的欄位`)
    if (typeof m.id !== 'string' || !m.id) errors.push(`${path}.id 必須是非空字串`)
    else if (byId.has(m.id)) errors.push(`${path}.id「${m.id}」重複`)
    else byId.set(m.id, m)
    if (!TYPES.has(m.type)) errors.push(`${path}.type 必須是 prefix、suffix、infix、reduplication 之一`)
    else if (m.type === 'reduplication') {
      if (!REDUPLICATION_PATTERNS.includes(m.pattern)) errors.push(`${path}.pattern 必須是 ${REDUPLICATION_PATTERNS.join('、')} 之一`)
      if (m.form !== undefined || m.forms !== undefined) errors.push(`${path}：重疊寫 pattern，不寫 form`)
    } else {
      if (m.pattern !== undefined) errors.push(`${path}.pattern 只用於重疊`)
      if ((m.form === undefined) === (m.forms === undefined)) errors.push(`${path} 需要 form 或 forms（恰好一個）`)
      const forms = m.forms ?? (m.form === undefined ? [] : [m.form])
      if (m.forms !== undefined && (!Array.isArray(m.forms) || m.forms.length === 0)) errors.push(`${path}.forms 必須是非空陣列`)
      else {
        forms.forEach((/** @type {unknown} */ f, /** @type {number} */ k) => {
          const where = m.forms ? `${path}.forms[${k}]` : `${path}.form`
          if (typeof f !== 'string' || !f) errors.push(`${where} 必須是非空字串`)
          else if (hasSpace(f)) errors.push(`${where} 不能含空白（詞綴不跨越詞邊界）`)
        })
        if (new Set(forms).size !== forms.length) errors.push(`${path}.forms 有重複的形式`)
      }
    }
    if (m.cost !== undefined && !(typeof m.cost === 'number' && Number.isFinite(m.cost) && m.cost >= 0)) errors.push(`${path}.cost 必須是非負的有限數`)
    if (m.free !== undefined && typeof m.free !== 'boolean') errors.push(`${path}.free 必須是 true 或 false`)
  })

  const constructions = Array.isArray(spec.constructions) ? spec.constructions : []
  if (spec.constructions !== undefined && !Array.isArray(spec.constructions)) errors.push('morphology.constructions 必須是陣列')
  const constructionIds = new Set()
  constructions.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    const path = `morphology.constructions[${i}]`
    if (!c || typeof c !== 'object') {
      errors.push(`${path} 必須是物件`)
      return
    }
    for (const key of Object.keys(c)) if (!CONSTRUCTION_KEYS.has(key)) errors.push(`${path}.${key} 是未知的欄位`)
    if (typeof c.id !== 'string' || !c.id) errors.push(`${path}.id 必須是非空字串`)
    else if (constructionIds.has(c.id) || byId.has(c.id)) errors.push(`${path}.id「${c.id}」重複（組合規則與詞素的 id 不能相同）`)
    else constructionIds.add(c.id)
    if (c.cost !== undefined && !(typeof c.cost === 'number' && Number.isFinite(c.cost) && c.cost >= 0)) errors.push(`${path}.cost 必須是非負的有限數`)
    if (!Array.isArray(c.sequence) || c.sequence.length < 2) {
      errors.push(`${path}.sequence 必須是至少兩個詞素 id 的陣列（推導順序）`)
      return
    }
    const missing = c.sequence.filter((/** @type {unknown} */ id) => typeof id !== 'string' || !byId.has(id))
    if (missing.length) errors.push(`${path}.sequence 有不存在的詞素：${missing.join('、')}`)
  })
  if (errors.length) return errors

  const size = expandedSize(spec)
  if (size > MAX_EXPANDED) return [`構詞文法展開後有 ${size} 項，超過上限 ${MAX_EXPANDED}：請減少同位詞素很多的詞素出現在組合規則裡的次數`]
  // 形狀：每一種同位詞素的選擇都做一次符號推導（不同的選擇，中綴可能落在前綴或詞根上），錯誤指出是哪一步
  const vowels = vowelSet(spec)
  constructions.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    const members = c.sequence.map((/** @type {string} */ id) => byId.get(id))
    for (const parts of choices(members)) {
      const r = evaluate(parts, vowels)
      if (!r.error) continue
      errors.push(`morphology.constructions[${i}]（${c.id}，${parts.map((p) => p.form).join(' ＋ ')}）：${r.error}`)
      break
    }
  })
  return errors
}

/**
 * 組合規則的每一種同位詞素選擇（依序列舉）。
 * @param {any[]} members
 * @returns {Generator<Array<{type: string, form: string}>>}
 */
function* choices(members) {
  if (members.length === 0) {
    yield []
    return
  }
  const [head, ...rest] = members
  const forms = head.type === 'reduplication' ? [head.pattern] : (head.forms ?? [head.form])
  for (const form of forms) for (const tail of choices(rest)) yield [{ type: head.type, form }, ...tail]
}

/** @param {Record<string, any>} spec @param {(s: string) => string} [normalize] */
const vowelSet = (spec, normalize = (s) => s) => new Set(Array.from(normalize(spec.vowels ?? 'aeiouéə')))

/**
 * 符號推導（檔頭的編譯原理）：依推導順序套用詞素，詞根是符號 X。
 * @param {Array<{type: string, form: string}>} steps 推導順序；重疊的 form 是型式
 * @param {Set<string>} vowels
 * @returns {{L: string, op: {type: 'infix' | 'reduplication', form: string} | null, R: string, error?: string}}
 */
export function evaluate(steps, vowels) {
  let L = ''
  let R = ''
  /** @type {{type: 'infix' | 'reduplication', form: string} | null} */
  let op = null
  for (const [k, s] of steps.entries()) {
    if (s.type === 'prefix') L = s.form + L
    else if (s.type === 'suffix') R = R + s.form
    else if (s.type === 'infix') {
      const chars = Array.from(L)
      let h = 0
      while (h < chars.length && !vowels.has(chars[h])) h++
      if (h < chars.length) L = [...chars.slice(0, h), s.form, ...chars.slice(h)].join('')
      else if (op) return { L, op, R, error: `第 ${k + 1} 個詞素（中綴 ${s.form}）也落在詞根上，但一個推導只能有一個詞根上的中綴或重疊` }
      else op = { type: 'infix', form: s.form }
    } else if (s.type === 'reduplication') {
      if (k > 0) return { L, op, R, error: `重疊只能是第一個（直接加在詞根上）；第 ${k + 1} 個是重疊` }
      op = { type: 'reduplication', form: s.form }
    }
  }
  return { L, op, R }
}

/** 笛卡兒積的大小 @param {Record<string, any>} spec */
function expandedSize(spec) {
  const byId = new Map((spec.morphemes ?? []).map((/** @type {any} */ m) => [m.id, m]))
  const count = (/** @type {any} */ m) => (m.type === 'reduplication' ? 1 : (m.forms?.length ?? 1))
  let size = 0
  for (const m of spec.morphemes ?? []) if (m.free !== false) size += count(m)
  for (const c of spec.constructions ?? []) size += c.sequence.reduce((/** @type {number} */ n, /** @type {string} */ id) => n * count(byId.get(id)), 1)
  return size
}

/**
 * 把文法展開成平面規格（檔頭的編譯原理）。輸入必須已通過 validateGrammar。
 * @param {Record<string, any>} spec
 * @param {(s: string) => string} [normalize] 詞綴的正規化（與搜尋鍵相同；插入中綴要看正規化後的元音）
 * @returns {MorphologySpec & {circumfixes: any[]}} 每一項帶 parts 與 rank
 */
export function expandGrammar(spec, normalize = (s) => s) {
  const vowels = vowelSet(spec, normalize)
  const cost = spec.cost ?? 0.3
  /** @type {Record<string, any>} */
  const out = { prefixes: [], suffixes: [], infixes: [], reduplication: [], circumfixes: [] }
  for (const key of SHARED_KEYS) if (spec[key] !== undefined) out[key] = spec[key]
  let rank = 0
  /** @param {any} m @returns {string[]} */
  const formsOf = (m) => (m.type === 'reduplication' ? [m.pattern] : (m.forms ?? [m.form]).map(normalize))
  /** @param {any} m @param {string} form @returns {Part} */
  const partOf = (m, form) => ({ id: m.id, type: m.type, form, gloss: m.gloss ?? null })

  /**
   * 一項：沒有 op、只有一側的是詞綴，其他的是環綴。
   * @param {{L: string, op: {type: string, form: string} | null, R: string}} r
   * @param {{gloss: Gloss, cost: number, parts: Part[]}} info
   */
  const emit = (r, info) => {
    const entry = { ...info, rank: rank++ }
    if (!r.op && !r.R) out.prefixes.push({ form: r.L, ...entry })
    else if (!r.op && !r.L) out.suffixes.push({ form: r.R, ...entry })
    else if (r.op && !r.L && !r.R) {
      if (r.op.type === 'infix') out.infixes.push({ form: r.op.form, ...entry })
      else out.reduplication.push({ pattern: r.op.form, ...entry })
    } else {
      // 中綴落在詞根上、外側有前綴：元音開頭的詞根上就是串接的 L·x（檔頭的說明）。串接的形式列在前面，
      // 同分時說明選它（兩項的 rank 相同）
      if (r.op?.type === 'infix' && r.L) out.circumfixes.push({ prefix: r.L + r.op.form, ...(r.R ? { suffix: r.R } : {}), stemInitial: 'V', ...entry })
      out.circumfixes.push({
        ...(r.L ? { prefix: r.L } : {}),
        ...(r.op ? { [r.op.type]: r.op.form } : {}),
        ...(r.R ? { suffix: r.R } : {}),
        ...entry,
      })
    }
  }

  // 自由的詞素在前：一個形式一項
  for (const m of spec.morphemes ?? []) {
    if (m.free === false) continue
    for (const form of formsOf(m)) {
      const part = partOf(m, form)
      emit(evaluate([part], vowels), { gloss: m.gloss ?? null, cost: m.cost ?? cost, parts: [part] })
    }
  }
  const byId = new Map((spec.morphemes ?? []).map((/** @type {any} */ m) => [m.id, m]))
  // 組合規則在後（依規格順序），每一種同位詞素的選擇一項
  for (const c of spec.constructions ?? []) {
    const members = c.sequence.map((/** @type {string} */ id) => byId.get(id))
    /** @param {number} k @param {Part[]} parts */
    const walk = (k, parts) => {
      if (k === members.length) {
        const r = evaluate(parts, vowels)
        emit(r, { gloss: c.gloss ?? null, cost: c.cost ?? cost, parts })
        return
      }
      for (const form of formsOf(members[k])) walk(k + 1, [...parts, partOf(members[k], form)])
    }
    walk(0, [])
  }
  return /** @type {any} */ (out)
}
