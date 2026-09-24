/**
 * @file 構詞分析：依語言設定檔的 `morphology` 規格，雙向處理詞綴。
 *
 * - `analyze(word)`：去詞綴。列出「這個詞形可能是由哪個詞幹加上哪些詞綴構成」
 *   （例如 `binaket` → 詞幹 `baket`＋中綴 `<in>`）。
 * - `generate(stem, steps)`：還原詞綴。把詞幹依步驟加回詞綴，得到詞形；
 *   `analyze` 的每一個結果都保證能用 `generate` 還原成原詞形（測試會檢查）。
 *
 * 規格是宣告式的純資料，概念上對應有限狀態構詞（FST）中的詞綴槽位、中綴、重疊與詞幹交替，
 * 但不編譯成轉錄器：分析是有界的列舉（步驟數有上限），候選是否為真正的詞幹，
 * 由使用端用詞庫檢查（搜尋引擎只採用詞庫中存在的詞幹）。這樣不需要完整的構詞語法，
 * 也不會因為規格不完整而產生大量假分析。
 *
 * ```json
 * "morphology": {
 *   "cost": 0.3,
 *   "minStem": 3,
 *   "prefixes": [{ "form": "mu", "gloss": { "zh-TW": "主事焦點", "en": "AF" } }],
 *   "suffixes": [{ "form": "an" }, { "form": "en" }],
 *   "infixes": [{ "form": "in" }],
 *   "reduplication": [{ "pattern": "Ca" }],
 *   "alternations": [{ "underlying": "t", "surface": "d", "before": ["an", "en"] }]
 * }
 * ```
 *
 * 完整說明見 docs/language-profile.md 的「構詞」一節。
 */

/** @typedef {string | Record<string, string> | null} Gloss 詞綴說明（可依介面語系提供） */

/**
 * @typedef {object} AffixSpec
 * @property {string} form 詞綴（不含連字號；會經過與搜尋鍵相同的正規化）
 * @property {Gloss} [gloss] 語法說明，例如 `{ "zh-TW": "主事焦點", "en": "AF" }`
 * @property {number} [cost] 剝除這個詞綴的成本（預設用規格的 `cost`）
 */

/**
 * @typedef {object} ReduplicationSpec
 * @property {'Ca' | 'CV' | 'full'} pattern
 *   Ca：詞幹首輔音＋a（`a-alep`、`sa-suzuk`）；CV：詞幹首輔音＋首元音；full：整個詞幹重疊
 * @property {Gloss} [gloss]
 * @property {number} [cost]
 */

/**
 * @typedef {object} AlternationSpec 詞幹交替：詞幹末的 underlying 在某些後綴前寫成 surface
 * @property {string} underlying 例如 `t`
 * @property {string} surface 例如 `d`（`bitut` ＋ `-un` → `bitudun`）
 * @property {string[]} [before] 只在這些後綴前發生；省略表示任何後綴前
 * @property {number} [cost]
 */

/**
 * @typedef {object} MorphologySpec 語言設定檔的 `morphology` 區段
 * @property {number} [cost=0.3] 每個構詞步驟的預設成本
 * @property {number} [minStem=3] 詞幹最短長度（code point）
 * @property {number} [maxSteps=3] 最多剝除幾層（交替不計）
 * @property {number} [stemDistance=0] 搜尋時詞幹允許的加權編輯距離。0 表示詞幹必須正好是詞庫中的詞；
 *   設成方言對應規則的權重（例如 0.1）可以讓「另一個方言的衍生詞 → 這個方言的詞根」也找得到，但會增加巧合命中
 * @property {string} [vowels='aeiouéə'] 元音字母（決定「首輔音」「首元音」與中綴位置）
 * @property {AffixSpec[]} [prefixes]
 * @property {AffixSpec[]} [suffixes]
 * @property {AffixSpec[]} [infixes] 插在詞幹首輔音（群）之後、首元音之前；元音開頭的詞幹則在最前面
 * @property {ReduplicationSpec[]} [reduplication]
 * @property {AlternationSpec[]} [alternations]
 */

/**
 * @typedef {object} MorphStep 一個構詞步驟（由外而內，也就是剝除的順序）
 * @property {'prefix' | 'suffix' | 'infix' | 'reduplication' | 'alternation'} type
 * @property {string} form 詞綴；重疊為實際的重疊部分；交替為 `underlying>surface`
 * @property {string} [pattern] 重疊的模式（Ca／CV／full）
 * @property {Gloss} gloss
 * @property {number} cost
 */

/**
 * @typedef {object} Analysis
 * @property {string} stem 詞幹（搜尋鍵形式）
 * @property {MorphStep[]} steps 由外而內的構詞步驟
 * @property {number} cost 各步驟成本的總和
 */

const DEFAULTS = Object.freeze({ cost: 0.3, minStem: 3, maxSteps: 3, stemDistance: 0, vowels: 'aeiouéə' })

/** 同一個詞最多回傳幾個分析，避免規格過寬時列舉爆量 */
const MAX_ANALYSES = 64

/**
 * 檢查規格的結構，回傳錯誤訊息清單。
 * @param {unknown} spec
 * @returns {string[]}
 */
export function validateMorphology(spec) {
  if (spec === undefined) return []
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['morphology 必須是物件']
  const s = /** @type {Record<string, any>} */ (spec)
  const errors = []
  for (const key of ['cost', 'minStem', 'maxSteps', 'stemDistance']) {
    if (s[key] !== undefined && !(typeof s[key] === 'number' && s[key] >= 0)) errors.push(`morphology.${key} 必須是非負數`)
  }
  if (s.vowels !== undefined && (typeof s.vowels !== 'string' || !s.vowels)) errors.push('morphology.vowels 必須是非空字串')
  for (const key of ['prefixes', 'suffixes', 'infixes']) {
    if (s[key] === undefined) continue
    if (!Array.isArray(s[key])) {
      errors.push(`morphology.${key} 必須是陣列`)
      continue
    }
    s[key].forEach((/** @type {any} */ a, /** @type {number} */ i) => {
      if (!a || typeof a.form !== 'string' || !a.form) errors.push(`morphology.${key}[${i}].form 必須是非空字串`)
      if (a?.cost !== undefined && !(typeof a.cost === 'number' && a.cost >= 0)) errors.push(`morphology.${key}[${i}].cost 必須是非負數`)
    })
  }
  if (s.reduplication !== undefined) {
    if (!Array.isArray(s.reduplication)) errors.push('morphology.reduplication 必須是陣列')
    else
      s.reduplication.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
        if (!['Ca', 'CV', 'full'].includes(r?.pattern)) errors.push(`morphology.reduplication[${i}].pattern 必須是 Ca、CV 或 full`)
      })
  }
  if (s.alternations !== undefined) {
    if (!Array.isArray(s.alternations)) errors.push('morphology.alternations 必須是陣列')
    else
      s.alternations.forEach((/** @type {any} */ a, /** @type {number} */ i) => {
        if (typeof a?.underlying !== 'string' || typeof a?.surface !== 'string' || !a.underlying || !a.surface) {
          errors.push(`morphology.alternations[${i}] 需要非空的 underlying 與 surface`)
        }
        if (a?.before !== undefined && !Array.isArray(a.before)) errors.push(`morphology.alternations[${i}].before 必須是陣列`)
      })
  }
  return errors
}

/**
 * @typedef {object} Analyzer
 * @property {(word: string) => Analysis[]} analyze 去詞綴：所有可能的（詞幹, 步驟）；已正規化的輸入
 * @property {(stem: string, steps: MorphStep[]) => string} generate 還原詞綴
 * @property {(stem: string) => string[]} coreForms 詞幹在衍生詞中可能的核心形式（找衍生詞時用）
 * @property {MorphologySpec} spec 正規化後的規格
 */

/**
 * 依規格建立構詞分析器。
 * @param {MorphologySpec} spec
 * @param {(s: string) => string} [normalize] 詞綴與輸入的正規化（應與搜尋鍵相同）
 * @returns {Analyzer}
 */
export function createAnalyzer(spec, normalize = (s) => s) {
  const errors = validateMorphology(spec)
  if (errors.length) throw new TypeError(`構詞規格格式錯誤：\n- ${errors.join('\n- ')}`)
  const cost = spec.cost ?? DEFAULTS.cost
  const minStem = spec.minStem ?? DEFAULTS.minStem
  const maxSteps = spec.maxSteps ?? DEFAULTS.maxSteps
  const stemDistance = spec.stemDistance ?? DEFAULTS.stemDistance
  const vowels = new Set(Array.from(normalize(spec.vowels ?? DEFAULTS.vowels)))

  /** @param {AffixSpec[] | undefined} list */
  const affixes = (list) =>
    (list ?? [])
      .map((a) => ({ form: normalize(a.form), gloss: a.gloss ?? null, cost: a.cost ?? cost }))
      .filter((a) => a.form)
  const prefixes = affixes(spec.prefixes)
  const suffixes = affixes(spec.suffixes)
  const infixes = affixes(spec.infixes)
  const reduplication = (spec.reduplication ?? []).map((r) => ({
    pattern: r.pattern,
    gloss: r.gloss ?? null,
    cost: r.cost ?? cost,
  }))
  const alternations = (spec.alternations ?? []).map((a) => ({
    underlying: normalize(a.underlying),
    surface: normalize(a.surface),
    before: a.before ? new Set(a.before.map(normalize)) : null,
    cost: a.cost ?? cost,
  }))

  /** @param {string} s */
  const len = (s) => Array.from(s).length
  /** 詞首的輔音（群）：第一個元音之前的所有字元 @param {string} w */
  const onset = (w) => {
    const chars = Array.from(w)
    let k = 0
    while (k < chars.length && !vowels.has(chars[k])) k++
    return chars.slice(0, k).join('')
  }
  /** 首元音 @param {string} w */
  const firstVowel = (w) => Array.from(w).find((c) => vowels.has(c)) ?? ''

  /**
   * 重疊部分：pattern 套用在詞幹 base 上時，前面要加的字串（不適用時為 null）。
   * @param {'Ca' | 'CV' | 'full'} pattern
   * @param {string} base
   */
  const reduplicant = (pattern, base) => {
    if (pattern === 'full') return base
    if (pattern === 'Ca') return `${onset(base)}a`
    const v = firstVowel(base)
    return v ? onset(base) + v : null
  }

  /**
   * @param {string} word
   * @returns {Analysis[]}
   */
  function analyze(word) {
    /** @type {Map<string, Analysis>} */
    const best = new Map()
    /**
     * @param {string} w 目前剩下的詞形
     * @param {MorphStep[]} steps
     * @param {number} total
     * @param {number} depth 已剝除的層數
     */
    const visit = (w, steps, total, depth) => {
      if (steps.length > 0) {
        const prev = best.get(w)
        if (!prev || total < prev.cost) best.set(w, { stem: w, steps, cost: round(total) })
      }
      if (depth >= maxSteps || best.size >= MAX_ANALYSES) return
      const n = len(w)

      for (const p of prefixes) {
        if (w.startsWith(p.form) && n - len(p.form) >= minStem) {
          visit(w.slice(p.form.length), [...steps, step('prefix', p.form, p.gloss, p.cost)], total + p.cost, depth + 1)
        }
      }
      for (const s of suffixes) {
        if (!w.endsWith(s.form) || n - len(s.form) < minStem) continue
        const rest = w.slice(0, w.length - s.form.length)
        const next = [...steps, step('suffix', s.form, s.gloss, s.cost)]
        visit(rest, next, total + s.cost, depth + 1)
        // 詞幹交替只在剛剝掉的後綴前面發生
        for (const a of alternations) {
          if ((a.before && !a.before.has(s.form)) || !rest.endsWith(a.surface)) continue
          const restored = rest.slice(0, rest.length - a.surface.length) + a.underlying
          if (len(restored) < minStem) continue
          visit(restored, [...next, step('alternation', `${a.underlying}>${a.surface}`, null, a.cost)], total + s.cost + a.cost, depth + 1)
        }
      }
      const head = onset(w)
      for (const x of infixes) {
        // 中綴位於首輔音（群）之後；拿掉之後，詞幹首輔音後面必須接元音，還原時位置才會一致
        if (!w.startsWith(x.form, head.length) || n - len(x.form) < minStem) continue
        const rest = head + w.slice(head.length + x.form.length)
        if (onset(rest) !== head) continue
        visit(rest, [...steps, step('infix', x.form, x.gloss, x.cost)], total + x.cost, depth + 1)
      }
      const chars = reduplication.length ? Array.from(w) : []
      for (const r of reduplication) {
        // 重疊部分在最前面：試每一種切法，看剩下的詞幹套用同一模式是否正好得到這個重疊部分
        for (let k = 1; k <= n - minStem; k++) {
          const red = chars.slice(0, k).join('')
          const base = chars.slice(k).join('')
          if (reduplicant(r.pattern, base) !== red) continue
          visit(base, [...steps, { type: 'reduplication', form: red, pattern: r.pattern, gloss: r.gloss, cost: r.cost }], total + r.cost, depth + 1)
        }
      }
    }
    visit(word, [], 0, 0)
    return [...best.values()].sort((a, b) => a.cost - b.cost || (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0))
  }

  /**
   * 還原詞綴：由內而外套回各步驟。
   * @param {string} stem
   * @param {MorphStep[]} steps 由外而內（即 analyze 回傳的順序）
   */
  function generate(stem, steps) {
    let w = stem
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i]
      if (s.type === 'prefix') w = s.form + w
      else if (s.type === 'suffix') w = w + s.form
      else if (s.type === 'infix') {
        const head = onset(w)
        w = head + s.form + w.slice(head.length)
      } else if (s.type === 'reduplication') {
        w = (reduplicant(/** @type {'Ca' | 'CV' | 'full'} */ (s.pattern), w) ?? '') + w
      } else if (s.type === 'alternation') {
        const [underlying, surface] = s.form.split('>')
        if (w.endsWith(underlying)) w = w.slice(0, w.length - underlying.length) + surface
      }
    }
    return w
  }

  /**
   * 詞幹在衍生詞中可能呈現的「核心形式」：詞幹本身，以及中綴、重疊、詞幹交替改變後的樣子。
   * 前綴、後綴只加在外面，衍生詞一定含有其中一種核心形式——所以「找出某個詞幹的所有衍生詞」
   * 可以先找含有核心形式的詞，再用 analyze 驗證，不必列舉所有詞綴組合。
   * @param {string} stem
   * @returns {string[]}
   */
  function coreForms(stem) {
    const out = new Set([stem])
    for (const x of infixes) out.add(generate(stem, [step('infix', x.form, null, 0)]))
    for (const r of reduplication) {
      const red = reduplicant(r.pattern, stem)
      if (red) out.add(red + stem)
    }
    for (const a of alternations) {
      if (stem.endsWith(a.underlying)) out.add(stem.slice(0, stem.length - a.underlying.length) + a.surface)
    }
    return [...out]
  }

  return {
    analyze,
    generate,
    coreForms,
    spec: { cost, minStem, maxSteps, stemDistance, vowels: [...vowels].join(''), prefixes, suffixes, infixes, reduplication, alternations: spec.alternations ?? [] },
  }
}

/**
 * @param {MorphStep['type']} type
 * @param {string} form
 * @param {Gloss} gloss
 * @param {number} cost
 * @returns {MorphStep}
 */
function step(type, form, gloss, cost) {
  return { type, form, gloss, cost }
}

/** @param {number} x */
function round(x) {
  return Math.round(x * 1e9) / 1e9
}
