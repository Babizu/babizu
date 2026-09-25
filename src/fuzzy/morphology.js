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
 * @typedef {'Ca' | 'CV' | 'CVV' | 'CVCV' | 'CVCVC' | 'full'} ReduplicationPattern
 * 重疊的型式（docs/bcdp.md 1.7）。重疊部分放在詞幹前面，由詞幹 base 依模板產生：
 * - Ca：首輔音（群）＋ a（`da~dius`、`la~luzuk`）
 * - CV：首輔音＋第一個元音（`su~suzuk`）
 * - CVV：首輔音＋第一個元音重複兩次，即元音加長（`dee~depex`、`kii~kita`）
 * - CVCV：base 從頭到第二個元音核為止，即「兩音節、去掉韻尾」（`kipu~kipud-i`、`luba~lubahing`）
 * - CVCVC：CVCV 再加上其後連續的輔音，即「兩音節、含韻尾」（噶哈巫語 `kudung~kudung`）
 * - full：整個詞幹重疊
 * 「首輔音」是第一個元音之前的字元；「元音核」是連續的元音字元（`aa`、`au` 算一個）。
 * 不在 `vowels` 中的字元（包括滑音 y、w 與喉塞音 '）都當作輔音。元音由規格決定，所以模板與語言無關。
 * 模板只套用在**詞幹**上，不含後綴：`kipu~kipud-i` 的重疊部分由 kipud 產生（docs/bcdp.md 1.4）。
 */

/** 支援的重疊型式 */
export const REDUPLICATION_PATTERNS = Object.freeze(['Ca', 'CV', 'CVV', 'CVCV', 'CVCVC', 'full'])

/**
 * @typedef {object} ReduplicationSpec
 * @property {ReduplicationPattern} pattern
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
 * @property {number} [maxSteps=3] 前綴、後綴各自最多幾個（另加至多一個中綴、重疊或詞幹交替；見 docs/bcdp.md 1.7）
 * @property {number} [lemmaDistance=0.3] 構詞命中時，詞幹部分允許的加權編輯距離（音變預算）。
 *   0 表示詞幹必須正好是詞庫中的詞；0.1–0.3 讓「另一個方言的衍生詞 → 這個方言的詞根」也找得到
 * @property {number} [affixDistance=0.2] 每個詞綴允許的加權編輯距離（詞綴本身的方言差異，例如 mine-／minu-）
 * @property {number} [lemmaSpread=0.6] 構詞命中只保留成本在「最佳 ＋ lemmaSpread」之內的詞，控制候選數
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
 * @property {ReduplicationPattern} [pattern] 重疊的型式
 * @property {Gloss} gloss
 * @property {number} cost
 */

/**
 * @typedef {object} Analysis
 * @property {string} stem 詞幹（搜尋鍵形式）
 * @property {MorphStep[]} steps 由外而內的構詞步驟
 * @property {number} cost 各步驟成本的總和
 */

const DEFAULTS = Object.freeze({
  cost: 0.3,
  minStem: 3,
  maxSteps: 3,
  lemmaDistance: 0.3,
  affixDistance: 0.2,
  lemmaSpread: 0.6,
  vowels: 'aeiouéə',
})

/** 同一個詞最多回傳幾個分析，避免規格過寬時列舉爆量 */
const MAX_ANALYSES = 64

/** analyze 的備忘最多記幾個詞（最久沒用的先丟）。衍生形方向對同一批候選詞反覆分析 */
const ANALYZE_MEMO_LIMIT = 4096

/** 規格頂層允許的欄位（拼錯的欄位會被默默忽略，所以列為錯誤） */
const SPEC_KEYS = new Set(['cost', 'minStem', 'maxSteps', 'lemmaDistance', 'affixDistance', 'lemmaSpread', 'vowels', 'prefixes', 'suffixes', 'infixes', 'reduplication', 'alternations'])
/** 各種項目允許的欄位；ref（出處）與 note（說明）供語言設定檔記錄依據，搜尋不使用 */
const ENTRY_KEYS = {
  affix: new Set(['form', 'gloss', 'cost', 'ref', 'note']),
  reduplication: new Set(['pattern', 'gloss', 'cost', 'ref', 'note']),
  alternation: new Set(['underlying', 'surface', 'before', 'cost', 'ref', 'note']),
}
/** maxSteps 的上限：前綴、後綴各自最多這麼多層（圖表以 Int8Array 記槽位，也避免指數級的列舉） */
const MAX_STEPS_LIMIT = 10
const hasSpace = (/** @type {string} */ s) => /\s/u.test(s)

/**
 * 檢查規格的結構，回傳錯誤訊息清單（空陣列表示沒有錯誤）。
 *
 * 除了型別與範圍，也檢查「會讓搜尋默默出錯」的情況：拼錯的欄位、詞綴含空白
 * （詞綴不跨越詞邊界，見 docs/bcdp.md 1.7）、非有限的成本。
 * @param {unknown} spec
 * @returns {string[]}
 */
export function validateMorphology(spec) {
  if (spec === undefined) return []
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['morphology 必須是物件']
  const s = /** @type {Record<string, any>} */ (spec)
  const errors = []
  const isCost = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const unknownKeys = (/** @type {any} */ entry, /** @type {Set<string>} */ allowed, /** @type {string} */ path) => {
    if (!entry || typeof entry !== 'object') return
    for (const key of Object.keys(entry)) if (!allowed.has(key)) errors.push(`${path}.${key} 是未知的欄位`)
  }

  for (const key of Object.keys(s)) if (!SPEC_KEYS.has(key)) errors.push(`morphology.${key} 是未知的欄位`)
  for (const key of ['cost', 'lemmaDistance', 'affixDistance', 'lemmaSpread']) {
    if (s[key] !== undefined && !isCost(s[key])) errors.push(`morphology.${key} 必須是非負的有限數`)
  }
  if (s.minStem !== undefined && !(Number.isInteger(s.minStem) && s.minStem >= 1)) errors.push('morphology.minStem 必須是 ≥ 1 的整數')
  if (s.maxSteps !== undefined && !(Number.isInteger(s.maxSteps) && s.maxSteps >= 0 && s.maxSteps <= MAX_STEPS_LIMIT)) {
    errors.push(`morphology.maxSteps 必須是 0–${MAX_STEPS_LIMIT} 的整數`)
  }
  if (s.vowels !== undefined && (typeof s.vowels !== 'string' || !s.vowels || hasSpace(s.vowels))) errors.push('morphology.vowels 必須是不含空白的非空字串')

  for (const key of ['prefixes', 'suffixes', 'infixes']) {
    if (s[key] === undefined) continue
    if (!Array.isArray(s[key])) {
      errors.push(`morphology.${key} 必須是陣列`)
      continue
    }
    s[key].forEach((/** @type {any} */ a, /** @type {number} */ i) => {
      const path = `morphology.${key}[${i}]`
      if (!a || typeof a.form !== 'string' || !a.form) errors.push(`${path}.form 必須是非空字串`)
      else if (hasSpace(a.form)) errors.push(`${path}.form 不能含空白（詞綴不跨越詞邊界）`)
      if (a?.cost !== undefined && !isCost(a.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
      unknownKeys(a, ENTRY_KEYS.affix, path)
    })
  }
  if (s.reduplication !== undefined) {
    if (!Array.isArray(s.reduplication)) errors.push('morphology.reduplication 必須是陣列')
    else
      s.reduplication.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
        const path = `morphology.reduplication[${i}]`
        if (!REDUPLICATION_PATTERNS.includes(r?.pattern)) errors.push(`${path}.pattern 必須是 ${REDUPLICATION_PATTERNS.join('、')} 之一`)
        if (r?.cost !== undefined && !isCost(r.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
        unknownKeys(r, ENTRY_KEYS.reduplication, path)
      })
  }
  if (s.alternations !== undefined) {
    if (!Array.isArray(s.alternations)) errors.push('morphology.alternations 必須是陣列')
    else
      s.alternations.forEach((/** @type {any} */ a, /** @type {number} */ i) => {
        const path = `morphology.alternations[${i}]`
        if (typeof a?.underlying !== 'string' || typeof a?.surface !== 'string' || !a.underlying || !a.surface) {
          errors.push(`${path} 需要非空的 underlying 與 surface`)
        } else if (hasSpace(a.underlying) || hasSpace(a.surface)) {
          errors.push(`${path} 的 underlying、surface 不能含空白`)
        }
        if (a?.before !== undefined && !(Array.isArray(a.before) && a.before.every((/** @type {unknown} */ b) => typeof b === 'string' && b !== '' && !hasSpace(b)))) {
          errors.push(`${path}.before 必須是非空、不含空白的後綴字串陣列`)
        }
        if (a?.cost !== undefined && !isCost(a.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
        unknownKeys(a, ENTRY_KEYS.alternation, path)
      })
  }
  return errors
}

/**
 * @typedef {object} Analyzer
 * @property {(word: string) => ReadonlyArray<Readonly<Analysis>>} analyze 去詞綴：所有可能的（詞幹, 步驟）；已正規化的輸入。
 *   結果有備忘，所以是深度凍結的（不能修改）
 * @property {() => void} clearCache 清掉 analyze 的備忘（量測冷快取時用）
 * @property {(stem: string, steps: MorphStep[]) => string} generate 還原詞綴
 * @property {(stem: string) => string[]} coreForms 詞幹在衍生詞中可能的核心形式（找衍生詞時用）
 * @property {(term: string, stem: string, cores?: string[]) => boolean} mayDerive
 *   term 能否由 stem 衍生的必要條件：不成立時 analyze(term) 一定沒有這個詞幹（成立時不一定有）
 * @property {(w: string) => string} onset 詞首的輔音（群）
 * @property {(pattern: ReduplicationPattern, base: string) => string | null} reduplicant 詞幹 base 套用重疊模式時前面要加的字串
 * @property {(pattern: ReduplicationPattern, rest: string[], red: string) => number[]} reduplicantStems
 *   重疊部分後面的字元 rest 中，哪些長度 L 的開頭 rest[0..L) 當作詞幹時，重疊部分正好是 red（遞增）
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
  const lemmaDistance = spec.lemmaDistance ?? DEFAULTS.lemmaDistance
  const affixDistance = spec.affixDistance ?? DEFAULTS.affixDistance
  const lemmaSpread = spec.lemmaSpread ?? DEFAULTS.lemmaSpread
  const vowels = new Set(Array.from(normalize(spec.vowels ?? DEFAULTS.vowels)))

  /** 說明複製一份再凍結：分析結果（有備忘）會引用它，但不能凍結呼叫端自己的物件 @param {Gloss | undefined} g */
  const glossOf = (g) => (g == null ? null : typeof g === 'string' ? g : Object.freeze({ ...g }))
  /** @param {AffixSpec[] | undefined} list */
  const affixes = (list) =>
    (list ?? [])
      .map((a) => Object.freeze({ form: normalize(a.form), gloss: glossOf(a.gloss), cost: a.cost ?? cost }))
      .filter((a) => a.form)
  const prefixes = affixes(spec.prefixes)
  const suffixes = affixes(spec.suffixes)
  const infixes = affixes(spec.infixes)
  const reduplication = (spec.reduplication ?? []).map((r) =>
    Object.freeze({
      pattern: r.pattern,
      gloss: glossOf(r.gloss),
      cost: r.cost ?? cost,
    }),
  )
  const alternations = (spec.alternations ?? []).map((a) => ({
    underlying: normalize(a.underlying),
    surface: normalize(a.surface),
    before: a.before ? new Set(a.before.map(normalize)) : null,
    cost: a.cost ?? cost,
  }))

  /** @param {string} s */
  const len = (s) => Array.from(s).length
  /** 第一個、最後一個 code point @param {string} w */
  const firstChar = (w) => String.fromCodePoint(/** @type {number} */ (w.codePointAt(0)))
  /** 位置 p（UTF-16）開始的 code point @param {string} w @param {number} p */
  const charAt = (w, p) => String.fromCodePoint(/** @type {number} */ (w.codePointAt(p)))
  const lastChar = (/** @type {string} */ w) => {
    const lo = w.charCodeAt(w.length - 1)
    const hi = w.charCodeAt(w.length - 2)
    return lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff ? w.slice(-2) : w.slice(-1)
  }
  /**
   * 依第一個（或最後一個）字元分組的詞綴，附上長度。組內保持規格的順序，所以 analyze 的走訪順序
   * （也就是同成本時留下哪一個分析）與逐一比對所有詞綴完全相同，只是略過不可能相符的。
   * @param {Array<{form: string, gloss: Gloss, cost: number}>} list
   * @param {(form: string) => string} key
   */
  const bucket = (list, key) => {
    /** @type {Map<string, Array<{affix: typeof list[number], length: number}>>} */
    const map = new Map()
    for (const affix of list) {
      const k = key(affix.form)
      if (!map.has(k)) map.set(k, [])
      map.get(k)?.push({ affix, length: len(affix.form) })
    }
    return map
  }
  const prefixesByFirst = bucket(prefixes, firstChar)
  const suffixesByLast = bucket(suffixes, lastChar)
  const suffixesByFirst = bucket(suffixes, firstChar)
  /** @type {Array<{affix: typeof prefixes[number], length: number}>} */
  const none = []
  /** 詞首的輔音（群）：第一個元音之前的所有字元 @param {string} w */
  const onset = (w) => {
    const chars = Array.from(w)
    let k = 0
    while (k < chars.length && !vowels.has(chars[k])) k++
    return chars.slice(0, k).join('')
  }
  /**
   * 重疊部分：pattern 套用在詞幹 base 上時，前面要加的字串（不適用時為 null）。
   * 模板的定義見 ReduplicationPattern。重疊複製的是 base 本身的形式：搜尋時 base 取自查詢，
   * 所以複製的是查詢的（方言）形式（docs/bcdp.md 1.4）。
   * @param {ReduplicationPattern} pattern
   * @param {string} base
   * @returns {string | null}
   */
  const reduplicant = (pattern, base) => {
    if (pattern === 'full') return base
    const chars = Array.from(base)
    const t = template(pattern, chars, 0)
    return t && chars.slice(0, t.end).join('') + t.extra
  }

  /**
   * 模板的本體：套用在 chars[from..) 上的結果，表示成「chars[from..end) 再接 extra」（extra 是空字串或一個字元），
   * 不適用時為 null。直接在字元陣列上計算、不配置字串，analyze 每個切點都要算一次。
   * @param {ReduplicationPattern} pattern
   * @param {string[]} chars
   * @param {number} from
   * @returns {{end: number, extra: string} | null}
   */
  const template = (pattern, chars, from) => {
    const n = chars.length
    if (pattern === 'full') return { end: n, extra: '' }
    let v1 = from
    while (v1 < n && !vowels.has(chars[v1])) v1++ // 第一個元音（沒有時 v1 ＝ n）
    if (pattern === 'Ca') return { end: v1, extra: 'a' }
    if (v1 === n) return null
    if (pattern === 'CV') return { end: v1 + 1, extra: '' }
    if (pattern === 'CVV') return { end: v1 + 1, extra: chars[v1] }
    // CVCV／CVCVC：第一個元音核之後，跳過輔音，找第二個元音核
    let k = v1
    while (k < n && vowels.has(chars[k])) k++ // 第一個元音核結束
    while (k < n && !vowels.has(chars[k])) k++ // 第二個音節的首輔音
    if (k >= n) return null // 只有一個音節
    while (k < n && vowels.has(chars[k])) k++ // 第二個元音核結束
    if (pattern === 'CVCVC') while (k < n && !vowels.has(chars[k])) k++ // 其後的輔音（韻尾）
    return { end: k, extra: '' }
  }

  /**
   * rest 是重疊部分後面的字元（詞幹＋後綴），回傳所有使 reduplicant(pattern, rest[0..L)) === red 的詞幹長度 L。
   *
   * 不必逐一試每個 L：令 w ＝ reduplicant(pattern, rest)。w 只由 rest 開頭 |w| 個字元決定——模板在
   * 位置 |w| 停下，不論那裡是字串結尾還是另一類字元（元音串、輔音串在兩種情況下都結束）——所以
   * L ≥ |w| 時 reduplicant(pattern, rest[0..L)) ＝ w（穩定引理，以 test/fuzzy/morphology.test.js 的
   * 性質測試檢查）。只有 L < |w| 需要逐一計算；
   * w 為 null（沒有元音，或只有一個音節）時，較短的開頭也一定是 null。
   * full 的重疊部分就是詞幹本身，只可能是 L ＝ |red|。
   * @param {ReduplicationPattern} pattern
   * @param {string[]} rest
   * @param {string} red
   * @returns {number[]}
   */
  const reduplicantStems = (pattern, rest, red) => {
    if (pattern === 'full') {
      const l = len(red)
      return l <= rest.length && rest.slice(0, l).join('') === red ? [l] : []
    }
    const whole = reduplicant(pattern, rest.join(''))
    if (whole === null) return []
    const stable = len(whole)
    /** @type {number[]} */
    const out = []
    for (let l = 1; l < Math.min(stable, rest.length + 1); l++) {
      if (reduplicant(pattern, rest.slice(0, l).join('')) === red) out.push(l)
    }
    if (whole === red) for (let l = stable; l <= rest.length; l++) out.push(l)
    return out
  }

  /**
   * 模板在 chars[k..) 上的結果 t 是否正好等於 chars[0..k)（即 reduplicant(pattern, chars[k..]) === chars[0..k)）。
   * @param {string[]} chars
   * @param {number} k
   * @param {{end: number, extra: string}} t
   */
  const sameAsPrefix = (chars, k, t) => {
    const body = t.end - k
    if (body + (t.extra ? 1 : 0) !== k) return false
    for (let j = 0; j < body; j++) if (chars[j] !== chars[k + j]) return false
    return !t.extra || chars[k - 1] === t.extra
  }

  /** @type {Map<string, ReadonlyArray<Readonly<Analysis>>>} 最近用過的在最後（Map 保持插入順序） */
  const memo = new Map()

  /**
   * @param {string} word
   * @returns {ReadonlyArray<Readonly<Analysis>>}
   */
  function analyze(word) {
    const cached = memo.get(word)
    if (cached) {
      memo.delete(word)
      memo.set(word, cached)
      return cached
    }
    const result = Object.freeze(
      enumerate(word).map((a) => {
        for (const s of a.steps) Object.freeze(s)
        Object.freeze(a.steps)
        return Object.freeze(a)
      }),
    )
    memo.set(word, result)
    if (memo.size > ANALYZE_MEMO_LIMIT) memo.delete(/** @type {string} */ (memo.keys().next().value))
    return result
  }

  /**
   * analyze 的本體（沒有備忘）。
   * @param {string} word
   * @returns {Analysis[]}
   */
  function enumerate(word) {
    /** @type {Map<string, Analysis>} */
    const best = new Map()
    /**
     * 步數預算與 BCDP 相同（docs/bcdp.md 1.2、1.7）：
     * - 前綴、後綴各自至多 maxSteps 個；另加至多一個非串接步驟（中綴、重疊或詞幹交替）
     * - 中綴與重疊位在「前綴鏈之內」的詞幹開頭：做了之後不能再剝前綴
     * - 重疊的模板只套用在詞幹上（不含後綴）：做了之後也不能再剝後綴
     * - 詞幹交替位在詞幹結尾、緊接最內層的後綴：做了之後不能再剝後綴；
     *   與它一起剝掉的那個後綴可以是第 maxSteps ＋ 1 個
     * @param {string} w 目前剩下的詞形
     * @param {MorphStep[]} steps
     * @param {number} total
     * @param {number} pre 已剝的前綴數
     * @param {number} suf 已剝的後綴數
     * @param {boolean} op 已用掉非串接步驟
     * @param {boolean} preClosed 前綴端已封閉（做過中綴或重疊）
     * @param {boolean} sufClosed 後綴端已封閉（做過詞幹交替或重疊）
     */
    const visit = (w, steps, total, pre, suf, op, preClosed, sufClosed) => {
      if (steps.length > 0) {
        const prev = best.get(w)
        if (!prev || total < prev.cost) best.set(w, { stem: w, steps, cost: round(total) })
      }
      if (best.size >= MAX_ANALYSES) return
      const n = len(w)

      if (!preClosed && pre < maxSteps && w) {
        for (const { affix: p, length } of prefixesByFirst.get(firstChar(w)) ?? none) {
          if (w.startsWith(p.form) && n - length >= minStem) {
            visit(w.slice(p.form.length), [...steps, step('prefix', p.form, p.gloss, p.cost)], total + p.cost, pre + 1, suf, op, preClosed, sufClosed)
          }
        }
      }
      if (!sufClosed && w) {
        for (const { affix: s, length } of suffixesByLast.get(lastChar(w)) ?? none) {
          if (!w.endsWith(s.form) || n - length < minStem) continue
          const rest = w.slice(0, w.length - s.form.length)
          const next = [...steps, step('suffix', s.form, s.gloss, s.cost)]
          if (suf < maxSteps) visit(rest, next, total + s.cost, pre, suf + 1, op, preClosed, sufClosed)
          // 詞幹交替只在剛剝掉的後綴前面發生（這個後綴可以是第 maxSteps ＋ 1 個）
          if (op || suf > maxSteps) continue
          for (const a of alternations) {
            if ((a.before && !a.before.has(s.form)) || !rest.endsWith(a.surface)) continue
            const restored = rest.slice(0, rest.length - a.surface.length) + a.underlying
            if (len(restored) < minStem) continue
            visit(restored, [...next, step('alternation', `${a.underlying}>${a.surface}`, null, a.cost)], total + s.cost + a.cost, pre, suf + 1, true, preClosed, true)
          }
        }
      }
      if (op) return
      const chars = infixes.length || reduplication.length ? Array.from(w) : []
      let h = 0
      while (h < chars.length && !vowels.has(chars[h])) h++
      const head = chars.slice(0, h).join('') // onset(w)
      for (const x of infixes) {
        // 中綴位於首輔音（群）之後；拿掉之後，詞幹首輔音後面必須接元音，還原時位置才會一致
        if (!w.startsWith(x.form, head.length) || n - len(x.form) < minStem) continue
        const rest = head + w.slice(head.length + x.form.length)
        if (onset(rest) !== head) continue
        visit(rest, [...steps, step('infix', x.form, x.gloss, x.cost)], total + x.cost, pre, suf, true, true, sufClosed)
      }
      for (const r of reduplication) {
        // 重疊部分在最前面：試每一種切法 k，看剩下的詞幹 chars[k..) 套用同一模式是否正好得到 chars[0..k)。
        // 模板只看詞幹，所以重疊是最內層的步驟，剩下的就是詞幹（兩端都封閉）
        for (let k = 1; k <= n - minStem; k++) {
          const t = template(r.pattern, chars, k)
          if (!t || !sameAsPrefix(chars, k, t)) continue
          const red = chars.slice(0, k).join('')
          const base = chars.slice(k).join('')
          visit(base, [...steps, { type: 'reduplication', form: red, pattern: r.pattern, gloss: r.gloss, cost: r.cost }], total + r.cost, pre, suf, true, true, true)
        }
      }
    }
    visit(word, [], 0, 0, 0, false, false, false)
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
        w = (reduplicant(/** @type {ReduplicationPattern} */ (s.pattern), w) ?? '') + w
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

  /**
   * term 能否由 stem 衍生的必要條件。不成立時 analyze(term) 一定沒有詞幹 stem，可以不必分析；成立時不一定有。
   *
   * 由 analyze 的步驟可知，stem 的衍生詞一定是「前綴鏈 · 核心形式 · 後綴鏈」：
   * - analyze 只剝與規格完全相同的詞綴，所以前綴鏈、後綴鏈都是詞綴形式原樣的串接；
   *   前綴至多 maxSteps 個，後綴至多 maxSteps 個（有詞幹交替時多一個）
   * - 中綴與重疊在所有前綴都剝掉之後才做，重疊又是最內層；交替緊接最內層的後綴。
   *   所以非串接步驟只改變詞幹的一端，核心形式（coreForms）在衍生詞中是連續的一段
   * 例外：詞幹沒有元音時，中綴的位置（首輔音之後）會落到後綴裡，核心形式不連續，這時一律回傳 true。
   * @param {string} term
   * @param {string} stem
   * @param {string[]} [cores] coreForms(stem)（呼叫端已經算好時傳入）
   */
  function mayDerive(term, stem, cores = coreForms(stem)) {
    if (infixes.length && !Array.from(stem).some((c) => vowels.has(c))) return true
    const L = term.length
    // pre[p]：term[0..p) 最少由幾個前綴拼成；suf[q]：term[q..L) 最少由幾個後綴拼成（UTF-16 位置，與 indexOf 一致）
    const pre = new Float64Array(L + 1).fill(Infinity)
    pre[0] = 0
    for (let p = 0; p < L; p++) {
      if (pre[p] >= maxSteps) continue
      for (const { affix } of prefixesByFirst.get(charAt(term, p)) ?? none) {
        if (term.startsWith(affix.form, p)) pre[p + affix.form.length] = Math.min(pre[p + affix.form.length], pre[p] + 1)
      }
    }
    const suf = new Float64Array(L + 1).fill(Infinity)
    suf[L] = 0
    for (let q = L - 1; q >= 0; q--) {
      for (const { affix } of suffixesByFirst.get(charAt(term, q)) ?? none) {
        if (term.startsWith(affix.form, q)) suf[q] = Math.min(suf[q], suf[q + affix.form.length] + 1)
      }
    }
    const maxSuffixes = maxSteps + (alternations.length ? 1 : 0)
    for (const core of cores) {
      for (let p = term.indexOf(core); p !== -1; p = term.indexOf(core, p + 1)) {
        if (pre[p] <= maxSteps && suf[p + core.length] <= maxSuffixes) return true
      }
    }
    return false
  }

  return {
    analyze,
    clearCache: () => memo.clear(),
    generate,
    coreForms,
    mayDerive,
    onset,
    reduplicant,
    reduplicantStems,
    // 深度凍結：analyze 的備忘依賴規格不變，而分析器內部直接使用這些陣列
    spec: Object.freeze({
      cost,
      minStem,
      maxSteps,
      lemmaDistance,
      affixDistance,
      lemmaSpread,
      vowels: [...vowels].join(''),
      prefixes: Object.freeze(prefixes),
      suffixes: Object.freeze(suffixes),
      infixes: Object.freeze(infixes),
      reduplication: Object.freeze(reduplication),
      alternations: Object.freeze(alternations.map((a) => Object.freeze({ ...a, before: a.before ? Object.freeze([...a.before]) : null }))),
    }),
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
