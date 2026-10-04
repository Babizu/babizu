/**
 * @file 構詞樣式的解析與比對（docs/pattern-query.md 第 3 節）。
 *
 * 查詢的構詞樣式（`pa-…`、`m<in>u-…`、`…-en`、`pa-kita`、`…-pa-…`）在這裡依語言設定檔的構詞規格解析成一組
 * **詞素條件**（MorphRequirement），再與拆解表（每個詞的所有 BCDP 拆法，src/search/parses.js）中、
 * 依模糊程度取到的拆法比對。比對的是詞素，不是字串：BCDP 的分析保留每個詞素實際的寫法
 * （構詞文法展開後的 parts，例如 minukan ＝ mu ＋ <in>，mineken ＝ m ＋ <in>）。
 *
 * ## 詞綴寫法的解析（依序）
 * 1. **同位詞素組**：構詞文法中寫在同一個詞素 `forms` 的寫法，加上共用寫法的同一類詞素連成一組。
 *    巴宰語 AF {m, mu, mi, me}、AF.m {m}、AF.C {mu, mi, me} 是同一組，所以 `m-…`、`mu-…`、`mi-…`、`me-…` 等價。
 *    寫在引號中（`"mu"-…`）只要那個寫法，不歸併。
 * 2. **組合的整體寫法**：構詞文法展開出的組合（mina ＝ ma ＋ <in>）換成它的詞素：`mina-…` ＝ `ma-<in>…`。
 * 3. **方言寫法**：以上都不是時，用語言設定檔的距離函式找最近的詞綴（噶哈巫語 `mo-` 依 u↔o 視為 mu-），附提示。
 * 4. 都找不到就報錯（BCDP 只認得規格中的詞綴，不認得的寫法永遠比不到），列出最接近的幾個。
 *
 * ## 詞根段與外側的 …
 * 構詞樣式以 - 分段，詞根段是 … 或寫出的詞根。寫在**最外側**（第一段或最後一段）、與詞根之間隔著詞綴的 …，
 * 表示那一側不錨定：`…-pa-…` 是「前綴中有 pa-」。哪一段是詞根依語言知識決定（resolve）：
 * 逐一假設每一段是詞根，其他段都要解析得成那一側的詞綴，外側的 … 只能在頭尾、與詞根之間要有詞綴。
 * **… 優先當詞根**：有 … 當得成詞根的讀法時只看這些（saa-i-… 是前綴 saa-、i-，不是詞根 saa 加後綴 -i 再加外側的 …）；
 * … 都當不成詞根時才考慮寫出的詞根（kita-en-…、…-pa-kita）。只有一種讀法成立時就是它。
 * `…-i-…` 的 i 是前綴也是後綴，兩個 … 都當得成詞根，報錯 E_AMBIGUOUS_SIDE。
 *
 * ## 比對規則（satisfies）
 * - 前綴：樣式中的前綴（由外而內）必須正好是這個拆法**最外面的幾個前綴**，而且彼此相連；後綴同樣，由最外面往內數。
 *   imini 拆成 i-mini 或 i-m-ini，最外層的前綴是 i-，所以 `m-…` 不中。
 * - 外側寫了 … 的那一側不錨定：列出的詞綴在那一側的任何位置連續出現即可（`…-m-…` 中 i-m-ini）。
 * - 列出的詞綴與詞根之間可以有沒列出的詞素（`pa-…`、`pa-kita` 都找到 pa-ka-kita）。
 * - 中綴、重疊不看位置，只要有（中綴的位置由語言決定，查詢的人不必知道它落在哪裡）。
 *
 * ## 取哪些拆法（PARSE_SELECTION，跟著模糊程度；selectParses）
 * 拆法有兩種，**分開取，不放在同一個尺度上比**（與自動派生圖的兩種邊相同）：
 * - **詞庫詞根的拆法**（BCDP）：先求 best＝BCDP 在詞庫中最好的命中（ParseChart.lexicalBestOf；最好的命中不是拆法時是那個命中），
 *   取成本在 best ＋ spread 之內的，再去掉音變超過 sound 的。
 *   順序是刻意的：最好的拆法要靠方言音變時，比它差的「拼寫完全相同」的拆法多半是巧合，不改取它。
 * - **虛擬詞根的拆法**：自動派生圖已經只留成本最低的（derivations.js 的條件），全部取（它們沒有音變）。
 *   它們只是補充，**不會把詞庫詞根的拆法擠掉**：虛擬詞根的成本是精確列舉的步驟成本，剝掉的詞綴少就便宜，
 *   與 BCDP 的成本不能比。曾經把兩種放在一起求 best，pinahazaban 的 pa-<in>hazap-an（0.25，交界濁化 0.05）
 *   被虛擬詞根 pinahazab-an（0.1）擠掉，pina-…-an 找不到它；語料中 344 個詞受影響（研究紀錄 U.20）。
 * 所以精確模式取到的，就是自動派生圖這個詞的邊（詞庫詞根同分全收、虛擬詞根）去掉音變超過上限的那些。
 *
 * 精確與標準的音變上限相同（0.2），差別只在要不要取次佳的拆法。精確曾經不容許任何音變：
 * 交界濁化（pinahazaban 的 hazap → hazab-，0.05）這種規律的構詞音變也被擋掉，最好的拆法落選，
 * 準確與召回都比較差（72.6%、60.2%，上限 0.2 時 75.4%、85.2%；研究紀錄 U.20）。
 */

import { PatternError } from './errors.js'

/** 方言寫法的詞綴最多差多少，才視為同一個（兩條 0.1 的方言規則） */
export const AFFIX_VARIANT_MAX = 0.25

/**
 * 依模糊程度取哪些拆法：spread 是詞庫詞根的拆法比 BCDP 在詞庫中最好的命中差多少以內，sound 是整個詞的音變上限。
 * 數字以潘德興詞彙表 184 個人工拆解（morphology.segmentation）為標準，量每個最外層詞綴條件的準確與召回
 * （minubizu tools/eval-parse-gold.mjs，研究紀錄 U.19；docs/pattern-query.md 3.6）：
 * | 模糊程度 | spread | sound | 準確 | 召回 |
 * | 精確 | 0（同分都取） | 0.2 | 75.4% | 85.2% |
 * | 標準 | 0.1 | 0.2 | 68.1% | 88.6% |
 * | 寬鬆 | 全部 | 0.4 | 57.5% | 91.5% |
 * （v0.6.0：自動派生圖最好的詞根、詞綴在任何位置，標準 59.9%、87.5%）
 */
export const PARSE_SELECTION = Object.freeze({
  exact: Object.freeze({ spread: 0, sound: 0.2 }),
  normal: Object.freeze({ spread: 0.1, sound: 0.2 }),
  loose: Object.freeze({ spread: Infinity, sound: 0.4 }),
})

const EPSILON = 1e-9

/**
 * 依模糊程度取一個詞的拆法（PARSE_SELECTION；規則見檔頭「取哪些拆法」）。
 * 詞庫詞根的拆法與虛擬詞根的拆法分開取：虛擬詞根的拆法再便宜，也不影響詞庫詞根的拆法取哪些。
 * @template {{cost: number, sound: number, virtual?: boolean}} T
 * @param {T[]} parses 這個詞的所有拆法
 * @param {string} fuzziness
 * @param {number} [floor] 詞庫詞根的拆法從哪個成本算起：BCDP 在詞庫中最好的命中（ParseChart.lexicalBestOf）；
 *   它不是拆法時（例如最接近的是另一個同樣長的詞）比所有拆法都低，與自動派生圖不建邊的條件相同。預設是最好的詞庫拆法
 * @returns {T[]}
 */
export function selectParses(parses, fuzziness, floor = Infinity) {
  if (parses.length === 0) return []
  const { spread, sound } = PARSE_SELECTION[/** @type {keyof typeof PARSE_SELECTION} */ (fuzziness)] ?? PARSE_SELECTION.normal
  const best = Math.min(floor, ...parses.filter((x) => !x.virtual).map((x) => x.cost))
  return parses.filter((x) => (x.virtual || x.cost <= best + spread + EPSILON) && x.sound <= sound + EPSILON)
}

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
 * @property {boolean} prefixesAnywhere 外側寫了 …（`…-pa-…`）：前綴不必是最外層，在任何位置連續出現即可
 * @property {boolean} suffixesAnywhere 同上，後綴（`…-en-…`）
 * @property {AffixGroup[]} infixes
 * @property {boolean} red 要有重疊
 */

/**
 * @typedef {{type: AffixType, form: string}} Morph 分析中的一個詞素（寫法是規格中的寫法，已是搜尋鍵）
 * @typedef {object} MorphReading 一種拆法的所有詞素（各步驟合起來）
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
    const n = core.length
    const span = { start: core[0].start, end: core[n - 1].end }
    /** 第 a 段與第 b 段之間有沒有詞綴（有字母、不是 … 的段） @param {number} a @param {number} b */
    const affixBetween = (a, b) => core.slice(Math.min(a, b) + 1, Math.max(a, b)).some((s) => s.host && !s.wildcard)
    /** 第 r 段當詞根時的形狀：其他的 … 只能在頭尾（外側的 …），而且與詞根之間要有詞綴 @param {number} r */
    const shapeOk = (r) => core.every((s, k) => !s.wildcard || k === r || ((k === 0 || k === n - 1) && affixBetween(k, r)))
    /** 第 r 段當詞根時，其他有字母的段都解析得成那一側的詞綴 @param {number} r */
    const affixesOk = (r) =>
      core.every((t, j) => j === r || !t.host || t.wildcard || resolveAffix(t.host, j < r ? 'prefix' : 'suffix', t.quoted, t, null))
    // 每一種讀法：詞根在第 r 段（… 或寫出的詞根）。… 優先當詞根：有 … 當得成詞根的讀法時，不再考慮寫出的詞根
    // （saa-i-… 是前綴 saa-、i- 加任意詞根，不是詞根 saa 加後綴 -i、外側的 …）；… 當不成詞根時才是外側的 …（kita-en-…）
    const readings = core.flatMap((s, r) => (s.host && shapeOk(r) && affixesOk(r) ? [r] : []))
    const wildRoots = readings.filter((r) => core[r].wildcard)
    const valid = wildRoots.length ? wildRoots : readings
    /** @type {number} */
    let rootAt
    if (valid.length === 1) rootAt = valid[0]
    else if (valid.length > 1) {
      // 好幾段都可以當詞根時（tau-en：tau 是詞根加 -en，或是前綴 tau- 加 en），寫出的詞根只留 BCDP 可能當成詞根的：
      // 至少 minStem 個字元（BCDP 的詞根不會更短），而且是詞庫中的詞或虛擬詞根
      const kept = valid.filter(
        (k) => core[k].wildcard || (Array.from(searchKey(core[k].host)).length >= spec.minStem && isRoot(searchKey(core[k].host))),
      )
      if (kept.length === 1) rootAt = kept[0]
      else if (kept.length > 1 && kept.every((k) => core[k].wildcard)) {
        // …-i-…：中間的詞綴是前綴也是後綴，看不出哪一個 … 是詞根
        const forms = core.filter((s) => s.host && !s.wildcard).map((s) => s.host).join('-')
        throw new PatternError('E_AMBIGUOUS_SIDE', span.start, span.end, { forms, prefix: `${forms}-…`, suffix: `…-${forms}` })
      } else throw new PatternError('E_AMBIGUOUS_ROOT', span.start, span.end, { segments: valid.map((k) => core[k].host) })
    } else {
      // 沒有一種讀法成立：選一段當詞根，讓下面的解析報出第一個不認得的詞綴
      // （有 … 時取不在頭尾的那一個、沒有就取最後一個；沒有 … 時取最長的一段）
      const wild = core.flatMap((s, k) => (s.wildcard ? [k] : []))
      if (wild.length) rootAt = wild.find((k) => k !== 0 && k !== n - 1) ?? wild[wild.length - 1]
      else {
        const hosts = core.map((s) => Array.from(s.host).length)
        rootAt = hosts.indexOf(Math.max(...hosts))
      }
      if (!shapeOk(rootAt)) throw new PatternError('E_MULTI_ROOT', span.start, span.end, { segments: wild.map((k) => core[k].host) })
    }
    /** @type {MorphRequirement} */
    const req = {
      root: null,
      rootExact: false,
      prefixes: [],
      suffixes: [],
      prefixesAnywhere: rootAt !== 0 && core[0].wildcard,
      suffixesAnywhere: rootAt !== n - 1 && core[n - 1].wildcard,
      infixes: [],
      red,
    }
    core.forEach((s, j) => {
      for (const x of s.infixes) for (const g of /** @type {AffixGroup[]} */ (resolveAffix(x.form, 'infix', false, x, warnings))) req.infixes.push(g)
      if (j === rootAt) {
        if (!s.wildcard) {
          req.root = searchKey(s.host)
          req.rootExact = s.quoted
        }
        return
      }
      if (!s.host || s.wildcard) return
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
 * 一種拆法（步驟由外而內）的所有詞素：前綴由外而內＝由最外層的步驟開始；後綴由內而外＝由最內層的步驟開始。
 * @param {import('../fuzzy/morph-search.js').MorphStepHit[]} steps
 * @returns {MorphReading}
 */
export function readingOfSteps(steps) {
  /** @type {MorphReading} */
  const out = { left: [], right: [], infixes: [], red: false }
  for (const step of steps) out.left.push(...stepMorphs(step).left)
  for (let j = steps.length - 1; j >= 0; j--) out.right.push(...stepMorphs(steps[j]).right)
  for (const step of steps) {
    const m = stepMorphs(step)
    out.infixes.push(...m.infixes)
    if (m.red) out.red = true
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
  /** 樣式中的詞綴從 have 的第 at 個起依序相連 @param {AffixGroup[]} want @param {Morph[]} have @param {number} at */
  const runAt = (want, have, at) => at >= 0 && at + want.length <= have.length && want.every((g, i) => g.forms.has(have[at + i].form))
  /** 在任何位置連續出現 @param {AffixGroup[]} want @param {Morph[]} have */
  const anywhere = (want, have) => {
    for (let at = 0; at + want.length <= have.length; at++) if (runAt(want, have, at)) return true
    return false
  }
  // 前綴由外而內：最外面的是 left[0]；後綴由內而外：最外面的是 right 的最後一個
  const prefixOk = req.prefixesAnywhere ? anywhere(req.prefixes, reading.left) : runAt(req.prefixes, reading.left, 0)
  const suffixOk = req.suffixesAnywhere
    ? anywhere(req.suffixes, reading.right)
    : runAt(req.suffixes, reading.right, reading.right.length - req.suffixes.length)
  if (!prefixOk || !suffixOk) return false
  // 中綴不看位置：每一個條件配一個不同的中綴
  const used = new Set()
  for (const g of req.infixes) {
    const k = reading.infixes.findIndex((m, i) => !used.has(i) && g.forms.has(m.form))
    if (k === -1) return false
    used.add(k)
  }
  return true
}
