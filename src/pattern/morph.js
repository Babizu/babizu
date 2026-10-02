/**
 * @file 構詞樣式的解析與比對（docs/pattern-query.md 第 3 節）。
 *
 * 查詢的構詞樣式（`pa-…`、`m<in>u-…`、`…-en`、`pa-kita`）在這裡依語言設定檔的構詞規格解析成一組
 * **詞素條件**（MorphRequirement），再與 BCDP 的分析（自動派生圖的路徑）比對。比對的是詞素，不是字串：
 * BCDP 的分析保留每個詞素實際的寫法（構詞文法展開後的 parts，例如 minukan ＝ mu ＋ <in>，mineken ＝ m ＋ <in>）。
 *
 * ## 詞綴寫法的解析（依序）
 * 1. **同位詞素組**：構詞文法中寫在同一個詞素 `forms` 的寫法，加上共用寫法的同一類詞素連成一組。
 *    巴宰語 AF {m, mu, mi, me}、AF.m {m}、AF.C {mu, mi, me} 是同一組，所以 `m-…`、`mu-…`、`mi-…`、`me-…` 等價。
 *    寫在引號中（`"mu"-…`）只要那個寫法，不歸併。
 * 2. **組合的整體寫法**：構詞文法展開出的組合（mina ＝ ma ＋ <in>）換成它的詞素：`mina-…` ＝ `ma-<in>…`。
 * 3. **方言寫法**：以上都不是時，用語言設定檔的距離函式找最近的詞綴（噶哈巫語 `mo-` 依 u↔o 視為 mu-），附提示。
 * 4. 都找不到就報錯（BCDP 只認得規格中的詞綴，不認得的寫法永遠比不到），列出最接近的幾個。
 *
 * ## 比對規則
 * - 前綴：樣式中的前綴（由外而內）必須是這個詞前綴的**子序列**（順序相同，可以有沒寫出來的）；後綴同樣（由內而外）。
 * - 中綴、重疊不看位置，只要有（中綴的位置由語言決定，查詢的人不必知道它落在哪裡）。
 */

import { PatternError } from './errors.js'

/** 方言寫法的詞綴最多差多少，才視為同一個（兩條 0.1 的方言規則） */
export const AFFIX_VARIANT_MAX = 0.25

/** @typedef {'prefix' | 'suffix' | 'infix'} AffixType */

/**
 * @typedef {object} AffixGroup 一個詞綴條件：詞的分析中這一類、寫法在 forms 中的詞素就算
 * @property {AffixType} type
 * @property {Set<string>} forms
 * @property {string} label 顯示用（`mu-`、`<in>`、`-en`）
 */

/**
 * @typedef {object} MorphRequirement 構詞樣式解析後的詞素條件
 * @property {string | null} root 寫出的詞根（搜尋鍵）；null 表示任意詞根（…）
 * @property {boolean} rootExact 詞根寫在引號中：只要這個拼寫（否則依模糊程度）
 * @property {AffixGroup[]} prefixes 由外而內
 * @property {AffixGroup[]} suffixes 由內而外
 * @property {AffixGroup[]} infixes
 * @property {boolean} red 要有重疊
 */

/**
 * @typedef {{type: AffixType, form: string}} Morph 分析中的一個詞素（寫法是規格中的寫法，已是搜尋鍵）
 * @typedef {object} MorphReading 一個詞相對於某個詞根的所有詞素（自動派生圖上一條路徑各層的步驟合起來）
 * @property {Morph[]} left 前綴，由外而內
 * @property {Morph[]} right 後綴，由內而外
 * @property {Morph[]} infixes
 * @property {boolean} red
 */

/**
 * 依構詞規格建立解析與比對的函式。
 * @param {import('../fuzzy/morphology.js').Analyzer['spec']} spec 分析器的規格（構詞文法已展開）
 * @param {(text: string) => string} searchKey
 * @param {(a: string, b: string) => number} distance 語言設定檔的距離函式（方言寫法的詞綴用）
 * @param {(key: string) => boolean} [isRoot] 是不是詞根（詞庫中的詞或虛擬詞根）：兩段都可以當詞根時（`tau-en`，
 *   tau 也是前綴）用來決定哪一段是詞根
 */
export function createPatternMorphology(spec, searchKey, distance, isRoot = () => false) {
  // 1. 同位詞素組：(類型, 詞素 id) 的寫法；同一類共用寫法的詞素連成一組（union-find）
  /** @type {Map<string, {type: AffixType, forms: Set<string>}>} */
  const nodes = new Map()
  /** @param {string} type @param {string} id @param {string} form */
  const addForm = (type, id, form) => {
    if (type !== 'prefix' && type !== 'suffix' && type !== 'infix') return
    if (!form) return
    const key = `${type}\u0000${id}`
    let node = nodes.get(key)
    if (!node) nodes.set(key, (node = { type, forms: new Set() }))
    node.forms.add(form)
  }
  /** @type {Array<{type: AffixType, form: string, parts: import('../fuzzy/grammar.js').Part[] | undefined}>} 規格中的各個寫法 */
  const entries = [
    ...spec.prefixes.map((a) => ({ type: /** @type {AffixType} */ ('prefix'), form: a.form, parts: a.parts })),
    ...spec.suffixes.map((a) => ({ type: /** @type {AffixType} */ ('suffix'), form: a.form, parts: a.parts })),
    ...spec.infixes.map((a) => ({ type: /** @type {AffixType} */ ('infix'), form: a.form, parts: a.parts })),
  ]
  for (const e of entries) {
    if (e.parts?.length) for (const p of e.parts) addForm(p.type, p.id, p.form)
    else addForm(e.type, `=${e.form}`, e.form)
  }
  for (const c of spec.circumfixes) {
    if (c.parts?.length) for (const p of c.parts) addForm(p.type, p.id, p.form)
    else {
      if (c.kind === 'prefix' || c.kind === 'infix') addForm(c.kind, `=${c.left}`, c.left)
      if (c.outer) addForm('prefix', `=${c.outer}`, c.outer)
      if (c.suffix) addForm('suffix', `=${c.suffix}`, c.suffix)
    }
  }
  const keys = [...nodes.keys()]
  const parent = new Map(keys.map((k) => [k, k]))
  /** @param {string} k @returns {string} */
  const find = (k) => {
    let r = k
    while (parent.get(r) !== r) r = /** @type {string} */ (parent.get(r))
    parent.set(k, r)
    return r
  }
  /** @type {Map<string, string>} (類型, 寫法) → 第一個有這個寫法的節點 */
  const firstWithForm = new Map()
  for (const [k, node] of nodes) {
    for (const f of node.forms) {
      const fk = `${node.type}\u0000${f}`
      const other = firstWithForm.get(fk)
      if (other) parent.set(find(k), find(other))
      else firstWithForm.set(fk, k)
    }
  }
  /** @type {Map<string, Set<string>>} 組的代表 → 組內所有寫法 */
  const groupForms = new Map()
  for (const [k, node] of nodes) {
    const r = find(k)
    let set = groupForms.get(r)
    if (!set) groupForms.set(r, (set = new Set()))
    for (const f of node.forms) set.add(f)
  }
  /** @type {Map<string, Set<string>>} (類型, 寫法) → 同位詞素組的所有寫法 */
  const groupOf = new Map()
  for (const [fk, k] of firstWithForm) groupOf.set(fk, /** @type {Set<string>} */ (groupForms.get(find(k))))

  // 2. 組合的整體寫法（mina、pina、minu、min…）→ 它的詞素（不含後綴：後綴在詞根的另一側）
  /** @type {Map<string, Array<Array<{type: AffixType, form: string}>>>} (類型, 寫法) → 各種組合 */
  const surfaces = new Map()
  /** @param {AffixType} side @param {string} form @param {import('../fuzzy/grammar.js').Part[] | undefined} parts */
  const addSurface = (side, form, parts) => {
    const list = (parts ?? []).filter((p) => p.type === 'prefix' || p.type === 'infix' || (side === 'suffix' && p.type === 'suffix'))
    if (list.length < 2 && !(list.length === 1 && list[0].form !== form)) return
    const key = `${side}\u0000${form}`
    const sig = list.map((p) => `${p.type}:${p.form}`).join('+')
    let all = surfaces.get(key)
    if (!all) surfaces.set(key, (all = []))
    if (!all.some((x) => x.map((p) => `${p.type}:${p.form}`).join('+') === sig)) all.push(list.map((p) => ({ type: /** @type {AffixType} */ (p.type), form: p.form })))
  }
  for (const e of entries) if (e.type !== 'infix') addSurface(e.type, e.form, e.parts)
  for (const c of spec.circumfixes) if (c.kind === 'prefix') addSurface('prefix', c.left, c.parts)

  /** @param {AffixType} type @param {string} form */
  const labelOf = (type, form) => (type === 'prefix' ? `${form}-` : type === 'suffix' ? `-${form}` : `<${form}>`)

  /** 規格中某一類的所有寫法（含組合的整體寫法） @param {AffixType} side */
  const formsOf = (side) => {
    const out = new Set()
    for (const fk of groupOf.keys()) if (fk.startsWith(`${side}\u0000`)) out.add(fk.slice(side.length + 1))
    for (const fk of surfaces.keys()) if (fk.startsWith(`${side}\u0000`)) out.add(fk.slice(side.length + 1))
    return [...out]
  }

  /**
   * 一個詞綴寫法 → 詞綴條件（組合的整體寫法會變成好幾個，例如 mina → ma- ＋ <in>）。
   * @param {string} text 寫法
   * @param {AffixType} side 在詞根的哪一側（中綴不分側）
   * @param {boolean} quoted 只要這個寫法
   * @param {{start: number, end: number}} at 在查詢中的位置（錯誤與提示用）
   * @param {import('./errors.js').PatternIssue[] | null} warnings null 時不嘗試方言寫法、不附提示（判斷詞根位置時用）
   * @returns {AffixGroup[] | null} 不是這一類的詞綴時為 null（warnings 不是 null 時改為丟出錯誤）
   */
  function resolveAffix(text, side, quoted, at, warnings) {
    const form = searchKey(text)
    const fail = () => {
      if (!warnings) return null
      const suggestions = formsOf(side)
        .map((f) => ({ f, d: distance(form, f) }))
        .sort((a, b) => a.d - b.d || (a.f < b.f ? -1 : 1))
        .slice(0, 3)
        .map((x) => labelOf(side, x.f))
      throw new PatternError('E_UNKNOWN_AFFIX', at.start, at.end, { form: labelOf(side, form || text), side, suggestions })
    }
    if (!form) return fail()
    const group = groupOf.get(`${side}\u0000${form}`)
    if (quoted) return group ? [{ type: side, forms: new Set([form]), label: labelOf(side, form) }] : fail()
    if (group) {
      // 同一個寫法也是某個組合的整體寫法時提示（ma- 是狀態 ma-；進行貌的 m<a>- 表面也寫成 ma）
      const other = surfaces.get(`${side}\u0000${form}`)?.find((parts) => !(parts.length === 1 && parts[0].form === form))
      if (other && warnings) {
        warnings.push({ code: 'W_ALSO_CONSTRUCTION', start: at.start, end: at.end, params: { form: labelOf(side, form), parts: other.map((p) => labelOf(p.type, p.form)).join(' ＋ ') } })
      }
      return [{ type: side, forms: group, label: labelOf(side, form) }]
    }
    const cons = surfaces.get(`${side}\u0000${form}`)
    if (cons) {
      return cons[0].map((p) => ({
        type: p.type,
        forms: groupOf.get(`${p.type}\u0000${p.form}`) ?? new Set([p.form]),
        label: labelOf(p.type, p.form),
      }))
    }
    if (!warnings) return null
    // 方言寫法：最近的規格寫法（距離函式與搜尋相同）
    let best = null
    for (const f of formsOf(side)) {
      const d = distance(form, f)
      if (d <= AFFIX_VARIANT_MAX && (!best || d < best.d || (d === best.d && f < best.f))) best = { f, d }
    }
    if (best) {
      warnings.push({ code: 'W_AFFIX_VARIANT', start: at.start, end: at.end, params: { form: labelOf(side, form), to: labelOf(side, best.f) } })
      return resolveAffix(best.f, side, false, at, warnings)
    }
    return fail()
  }

  /**
   * 構詞樣式的各段 → 詞素條件。
   * @param {import('./ast.js').MorphSegment[]} segments
   * @param {import('./errors.js').PatternIssue[]} warnings
   * @returns {MorphRequirement}
   */
  function resolve(segments, warnings) {
    const red = segments.some((s) => s.red)
    const core = segments.filter((s) => !s.red)
    // 詞根段：寫成 … 的那一段；沒有時，是「其他段都解析得成詞綴」的那一段
    const wild = core.flatMap((s, k) => (s.wildcard ? [k] : []))
    if (wild.length > 1) throw new PatternError('E_MULTI_ROOT', core[wild[0]].start, core[wild[wild.length - 1]].end, { segments: wild.map((k) => core[k].host) })
    let rootAt = wild.length === 1 ? wild[0] : -1
    if (rootAt === -1) {
      const valid = core.flatMap((s, i) => {
        if (!s.host) return []
        const ok = core.every((t, j) => j === i || !t.host || resolveAffix(t.host, j < i ? 'prefix' : 'suffix', t.quoted, t, null))
        return ok ? [i] : []
      })
      // 好幾段都可以當詞根時（tau-en：tau 是詞根加 -en，或是前綴 tau- 加 en），只留 BCDP 可能當成詞根的：
      // 至少 minStem 個字元（BCDP 的詞根不會更短），而且是詞庫中的詞或虛擬詞根
      const roots = valid.length > 1 ? valid.filter((k) => Array.from(searchKey(core[k].host)).length >= spec.minStem && isRoot(searchKey(core[k].host))) : valid
      if (roots.length > 1 || (roots.length === 0 && valid.length > 1)) {
        throw new PatternError('E_AMBIGUOUS_ROOT', core[0].start, core[core.length - 1].end, { segments: valid.map((k) => core[k].host) })
      }
      if (roots.length === 1) rootAt = roots[0]
      else {
        // 每一段都當不成詞根：以最長的一段當詞根，報出第一個不認得的詞綴
        const hosts = core.map((s) => Array.from(s.host).length)
        rootAt = hosts.indexOf(Math.max(...hosts))
      }
    }
    /** @type {MorphRequirement} */
    const req = { root: null, rootExact: false, prefixes: [], suffixes: [], infixes: [], red }
    core.forEach((s, j) => {
      for (const x of s.infixes) for (const g of /** @type {AffixGroup[]} */ (resolveAffix(x.form, 'infix', false, x, warnings))) req.infixes.push(g)
      if (j === rootAt) {
        if (!s.wildcard) {
          req.root = searchKey(s.host)
          req.rootExact = s.quoted
        }
        return
      }
      if (!s.host) return
      for (const g of /** @type {AffixGroup[]} */ (resolveAffix(s.host, j < rootAt ? 'prefix' : 'suffix', s.quoted, s, warnings))) {
        if (g.type === 'infix') req.infixes.push(g)
        else if (g.type === 'prefix') req.prefixes.push(g)
        else req.suffixes.push(g)
      }
    })
    return req
  }

  return { resolve, groupOf: (/** @type {AffixType} */ type, /** @type {string} */ form) => groupOf.get(`${type}\u0000${form}`) ?? null }
}

/**
 * 一個構詞步驟的詞素（構詞文法的 parts 依推導順序：前綴由內而外、後綴由內而外）。
 * 沒有 parts 的規格（平面清單）依步驟的類型拆。
 * @param {import('../fuzzy/morph-search.js').MorphStepHit} step
 * @returns {MorphReading}
 */
export function stepMorphs(step) {
  /** @type {MorphReading} */
  const m = { left: [], right: [], infixes: [], red: false }
  if (step.parts?.length) {
    m.left = step.parts.filter((p) => p.type === 'prefix').map((p) => ({ type: /** @type {AffixType} */ ('prefix'), form: p.form })).reverse()
    m.right = step.parts.filter((p) => p.type === 'suffix').map((p) => ({ type: /** @type {AffixType} */ ('suffix'), form: p.form }))
    m.infixes = step.parts.filter((p) => p.type === 'infix').map((p) => ({ type: /** @type {AffixType} */ ('infix'), form: p.form }))
    m.red = step.parts.some((p) => p.type === 'reduplication')
    return m
  }
  switch (step.type) {
    case 'prefix':
      m.left = [{ type: 'prefix', form: step.form }]
      break
    case 'suffix':
      m.right = [{ type: 'suffix', form: step.form }]
      break
    case 'infix':
      m.infixes = [{ type: 'infix', form: step.form }]
      break
    case 'reduplication':
      m.red = true
      break
    case 'circumfix': {
      const left = step.left
      if (left?.type === 'prefix') m.left = [{ type: 'prefix', form: left.form }]
      else if (left?.type === 'infix') m.infixes = [{ type: 'infix', form: left.form }]
      else if (left?.type === 'reduplication') m.red = true
      // 左邊是中綴或重疊時，緊貼詞幹的前綴（m<a>- 的 m）
      if (step.outer) m.left = [{ type: 'prefix', form: step.outer }, ...m.left]
      if (step.suffix) m.right = [{ type: 'suffix', form: step.suffix }]
      break
    }
  }
  return m
}

/**
 * 自動派生圖上一條路徑（由詞根往下，最後一條邊進入這個詞）的所有詞素。
 * 每條邊的步驟由外而內；越下面的邊越外層：前綴由外而內＝由最後一條邊的最外層步驟開始，
 * 後綴由內而外＝由第一條邊的最內層步驟開始。
 * @param {Array<{analysis: {steps: import('../fuzzy/morph-search.js').MorphStepHit[]}}>} path
 * @returns {MorphReading}
 */
export function readingOfPath(path) {
  /** @type {MorphReading} */
  const out = { left: [], right: [], infixes: [], red: false }
  for (let k = path.length - 1; k >= 0; k--) {
    for (const step of path[k].analysis.steps) out.left.push(...stepMorphs(step).left)
  }
  for (let k = 0; k < path.length; k++) {
    const steps = path[k].analysis.steps
    for (let j = steps.length - 1; j >= 0; j--) out.right.push(...stepMorphs(steps[j]).right)
  }
  for (const e of path) {
    for (const step of e.analysis.steps) {
      const m = stepMorphs(step)
      out.infixes.push(...m.infixes)
      if (m.red) out.red = true
    }
  }
  return out
}

/**
 * 詞素條件是否成立（詞根另外檢查）。
 * @param {MorphRequirement} req
 * @param {MorphReading} reading
 */
export function satisfies(req, reading) {
  if (req.red && !reading.red) return false
  /** 樣式中的詞綴依序是詞的詞綴的子序列 @param {AffixGroup[]} want @param {Morph[]} have */
  const subsequence = (want, have) => {
    let j = 0
    for (const m of have) if (j < want.length && want[j].forms.has(m.form)) j++
    return j === want.length
  }
  if (!subsequence(req.prefixes, reading.left) || !subsequence(req.suffixes, reading.right)) return false
  // 中綴不看位置：每一個條件配一個不同的中綴
  const used = new Set()
  for (const g of req.infixes) {
    const k = reading.infixes.findIndex((m, i) => !used.has(i) && g.forms.has(m.form))
    if (k === -1) return false
    used.add(k)
  }
  return true
}
