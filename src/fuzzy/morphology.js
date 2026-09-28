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
 *   "alternations": [{ "underlying": "t", "surface": "d", "position": "final" }]
 * }
 * ```
 *
 * 規格也可以用構詞文法寫（詞素與組合規則，grammar.js）：載入時展開成上面這種平面清單，之後完全相同。
 *
 * 完整說明見 docs/language-profile.md 的「構詞」一節與 docs/morph-grammar.md。
 */

import { expandGrammar, isGrammarSpec, validateGrammar } from './grammar.js'

/** @typedef {string | Record<string, string> | null} Gloss 詞綴說明（可依介面語系提供） */

/**
 * @typedef {object} AffixSpec
 * @property {string} form 詞綴（不含連字號；會經過與搜尋鍵相同的正規化）
 * @property {Gloss} [gloss] 語法說明，例如 `{ "zh-TW": "主事焦點", "en": "AF" }`
 * @property {number} [cost] 剝除這個詞綴的成本（預設用規格的 `cost`）
 */

/**
 * @typedef {import('./grammar.js').Part} Part 由構詞文法展開的項目帶著它由哪些詞素構成（說明用）
 */

/**
 * @typedef {'Ca' | 'CV' | 'CVV' | 'CVCV' | 'CVCVC' | 'full'} ReduplicationPattern
 * 重疊的型式（docs/bcdp.md 1.6）。重疊部分放在詞幹前面，由詞幹 base 依模板產生：
 * - Ca：首輔音（群）＋ a（`da~dius`、`la~luzuk`）
 * - CV：首輔音＋第一個元音（`ki~kiliw`、`du~dusa`）
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
 * @typedef {object} AlternationSpec 構詞音變：只在詞素交界發生的音變，例如詞幹末的 t 在後綴前寫成 d
 * （`bitut` ＋ `-un` → `bitudun`）。它是一條只在交界適用的規則（docs/bcdp.md 1.3），與方言規則同一套 DP：
 * 查詢（表面）的 surface 對應到底層（詞庫、詞綴）的 underlying。
 * @property {string} underlying 例如 `t`（可以是空字串：交界上的增生）
 * @property {string} surface 例如 `d`（可以是空字串：交界上的脫落）
 * @property {'final' | 'initial' | 'any'} [position='final'] underlying 在交界的哪一側：
 *   final ＝ 交界前那個詞素的結尾（詞幹末的 t），initial ＝ 交界後那個詞素的開頭，any ＝ 任一側
 * @property {number} [cost]
 */

/**
 * @typedef {object} CircumfixSpec 環綴（包覆單位）：緊貼詞幹的幾個部分一起出現，合起來算**一個**構詞步驟
 * （`ta-kita-aw`、`m<in>…-an`、`da~daux-ay`、`m<a>-usa`、`m<a>-usa-ay`）。三個部分中至少要有兩個：
 * @property {string} [prefix] 緊貼詞幹的前綴，例如 `ta`（`ta-…-aw`）、`m`（`m<a>-`）
 * @property {string} [infix] 詞幹上的中綴，例如 `in`（`<in>…-an`）
 * @property {ReduplicationPattern} [reduplication] 詞幹上的重疊型式，例如 `Ca`（`Ca-…-ay`）；與 infix 至多一個
 * @property {string} [suffix] 緊貼詞幹的後綴，例如 `aw`
 * @property {'V'} [stemInitial] 詞幹必須以元音開頭（只用於只有前綴、沒有中綴與重疊的環綴）。
 *   構詞文法展開時產生：只有輔音的前綴插入中綴（m ＋ <a>），在元音開頭的詞根上就是串接的 ma·usa
 *   （docs/morph-grammar.md 第 2 節）；這時可以沒有後綴（緊貼詞幹的前綴）
 * @property {Gloss} [gloss]
 * @property {number} [cost]
 * 環綴緊貼著詞幹：前綴是最內層的前綴，中綴、重疊在詞幹上，後綴是最內層的後綴，
 * 其他詞綴只能加在它們外面（docs/bcdp.md 1.2）。前綴 ＋ 中綴（m ＋ <a>）與「中綴先加在詞幹上、再加前綴」
 * 表面相同（docs/morph-grammar.md 第 2 節），所以中綴一律在詞幹上還原。
 */

/**
 * @typedef {object} MorphologySpec 語言設定檔的 `morphology` 區段
 * @property {number} [cost=0.3] 每個構詞步驟的預設成本
 * @property {number} [minStem=3] 詞根（詞庫詞）最短長度（code point）；查詢至少要多一個字元
 * @property {number} [maxSteps=3] 前綴、後綴各自最多幾個（另加至多一個包覆單位：中綴、重疊或環綴；見 docs/bcdp.md 1.6）
 * @property {number} [lemmaSpread=0.6] 構詞命中只保留成本在「最佳 ＋ lemmaSpread」之內的詞，控制候選數
 * @property {string} [vowels='aeiouéə'] 元音字母（決定「首輔音」「首元音」與中綴位置）
 * @property {AffixSpec[]} [prefixes]
 * @property {AffixSpec[]} [suffixes]
 * @property {AffixSpec[]} [infixes] 插在詞幹首輔音（群）之後、首元音之前；元音開頭的詞幹則在最前面
 * @property {ReduplicationSpec[]} [reduplication]
 * @property {CircumfixSpec[]} [circumfixes]
 * @property {AlternationSpec[]} [alternations]
 */

/**
 * @typedef {object} MorphStep 一個構詞步驟（由外而內，也就是剝除的順序）
 * @property {'prefix' | 'suffix' | 'infix' | 'reduplication' | 'alternation' | 'circumfix'} type
 * @property {string} form 詞綴；重疊為實際的重疊部分；交替為 `underlying>surface`；環綴為 `左邊…後綴`
 * @property {ReduplicationPattern} [pattern] 重疊的型式
 * @property {{type: 'prefix' | 'infix' | 'reduplication', form: string, pattern?: ReduplicationPattern}} [left]
 *   環綴左邊的部分：前綴，或詞幹上的中綴、重疊（重疊的 form 是實際的重疊部分）
 * @property {string} [outer] 環綴的左邊是中綴或重疊時，緊貼詞幹的前綴（m<a>- 的 m）
 * @property {string} [suffix] 環綴的後綴（可以是空字串：沒有後綴的環綴）
 * @property {Gloss} gloss
 * @property {number} cost
 * @property {Part[]} [parts] 構詞文法：由哪些詞素構成（推導順序）
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
  lemmaSpread: 0.6,
  vowels: 'aeiouéə',
})

/** 構詞音變在規則表中的分類名稱（說明中顯示為構詞音變，而不是方言差異） */
export const ALTERNATION_CATEGORY = '構詞音變'

/** 已移除的欄位與原因：舊的設定檔會得到明確的錯誤訊息，而不是默默被忽略 */
const REMOVED_KEYS = {
  lemmaDistance: '已移除：音變改以整個詞計算（規則可以跨越詞素交界），只受總成本上限與 lemmaSpread 限制（docs/bcdp.md 1.6）',
  affixDistance: '已移除：音變改以整個詞計算（規則可以跨越詞素交界），只受總成本上限與 lemmaSpread 限制（docs/bcdp.md 1.6）',
}
const POSITIONS = new Set(['final', 'initial', 'any'])

/** 同一個詞最多回傳幾個分析，避免規格過寬時列舉爆量 */
const MAX_ANALYSES = 64

/** analyze 的備忘最多記幾個詞（最久沒用的先丟）。同一批詞常被反覆分析（多詞查詢、實驗室） */
const ANALYZE_MEMO_LIMIT = 4096

/** 規格頂層允許的欄位（拼錯的欄位會被默默忽略，所以列為錯誤） */
const SPEC_KEYS = new Set(['cost', 'minStem', 'maxSteps', 'lemmaSpread', 'vowels', 'prefixes', 'suffixes', 'infixes', 'reduplication', 'circumfixes', 'alternations'])
/** 各種項目允許的欄位；ref（出處）與 note（說明）供語言設定檔記錄依據，搜尋不使用 */
const ENTRY_KEYS = {
  affix: new Set(['form', 'gloss', 'cost', 'ref', 'note']),
  reduplication: new Set(['pattern', 'gloss', 'cost', 'ref', 'note']),
  alternation: new Set(['underlying', 'surface', 'position', 'cost', 'ref', 'note']),
  circumfix: new Set(['prefix', 'infix', 'reduplication', 'suffix', 'stemInitial', 'gloss', 'cost', 'ref', 'note']),
}
/** maxSteps 的上限：前綴、後綴各自最多這麼多層（圖表以 Int8Array 記槽位，也避免指數級的列舉） */
const MAX_STEPS_LIMIT = 10
const hasSpace = (/** @type {string} */ s) => /\s/u.test(s)

/**
 * 檢查規格的結構，回傳錯誤訊息清單（空陣列表示沒有錯誤）。
 *
 * 除了型別與範圍，也檢查「會讓搜尋默默出錯」的情況：拼錯的欄位、詞綴含空白
 * （詞綴不跨越詞邊界，見 docs/bcdp.md 1.6）、非有限的成本。
 * @param {unknown} spec
 * @returns {string[]}
 */
export function validateMorphology(spec) {
  if (spec === undefined) return []
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['morphology 必須是物件']
  const s = /** @type {Record<string, any>} */ (spec)
  // 構詞文法寫法（morphemes、constructions）由 grammar.js 檢查；共用的欄位再回到這裡
  if (isGrammarSpec(s)) return validateGrammar(s)
  const errors = []
  const isCost = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const unknownKeys = (/** @type {any} */ entry, /** @type {Set<string>} */ allowed, /** @type {string} */ path) => {
    if (!entry || typeof entry !== 'object') return
    for (const key of Object.keys(entry)) if (!allowed.has(key)) errors.push(`${path}.${key} 是未知的欄位`)
  }

  for (const key of Object.keys(s)) {
    if (key in REMOVED_KEYS) errors.push(`morphology.${key} ${REMOVED_KEYS[/** @type {keyof typeof REMOVED_KEYS} */ (key)]}`)
    else if (!SPEC_KEYS.has(key)) errors.push(`morphology.${key} 是未知的欄位`)
  }
  for (const key of ['cost', 'lemmaSpread']) {
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
  if (s.circumfixes !== undefined) {
    if (!Array.isArray(s.circumfixes)) errors.push('morphology.circumfixes 必須是陣列')
    else
      s.circumfixes.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
        const path = `morphology.circumfixes[${i}]`
        const parts = ['prefix', 'infix', 'reduplication', 'suffix'].filter((k) => c?.[k] !== undefined)
        if (c?.stemInitial !== undefined && (c.stemInitial !== 'V' || c.prefix === undefined || c.infix !== undefined || c.reduplication !== undefined)) {
          errors.push(`${path}.stemInitial 只能是 'V'，而且只用於只有前綴（與後綴）的環綴`)
        }
        if (c?.infix !== undefined && c?.reduplication !== undefined) errors.push(`${path} 的 infix 與 reduplication 至多一個（詞幹上只有一個運算）`)
        else if (parts.length < 2 && c?.stemInitial === undefined) errors.push(`${path} 至少要有兩個部分：prefix、infix（或 reduplication）、suffix 中的兩個以上；只有一個部分的請寫成一般的詞綴`)
        for (const k of ['prefix', 'infix', 'suffix']) {
          if (c?.[k] === undefined) continue
          if (typeof c[k] !== 'string' || !c[k]) errors.push(`${path}.${k} 必須是非空字串`)
          else if (hasSpace(c[k])) errors.push(`${path}.${k} 不能含空白（詞綴不跨越詞邊界）`)
        }
        if (c?.reduplication !== undefined && !REDUPLICATION_PATTERNS.includes(c.reduplication)) {
          errors.push(`${path}.reduplication 必須是 ${REDUPLICATION_PATTERNS.join('、')} 之一`)
        }
        if (c?.cost !== undefined && !isCost(c.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
        unknownKeys(c, ENTRY_KEYS.circumfix, path)
      })
  }
  if (s.alternations !== undefined) {
    if (!Array.isArray(s.alternations)) errors.push('morphology.alternations 必須是陣列')
    else
      s.alternations.forEach((/** @type {any} */ a, /** @type {number} */ i) => {
        const path = `morphology.alternations[${i}]`
        if (typeof a?.underlying !== 'string' || typeof a?.surface !== 'string' || (!a.underlying && !a.surface)) {
          errors.push(`${path} 需要 underlying 與 surface（字串，不能兩者都是空字串）`)
        } else if (hasSpace(a.underlying) || hasSpace(a.surface)) {
          errors.push(`${path} 的 underlying、surface 不能含空白`)
        } else if (a.underlying === a.surface) {
          errors.push(`${path} 的 underlying 與 surface 相同`)
        }
        if (a?.position !== undefined && !POSITIONS.has(a.position)) errors.push(`${path}.position 必須是 final、initial 或 any`)
        if (a?.before !== undefined) errors.push(`${path}.before 已移除：構詞音變在任何詞素交界都適用（docs/bcdp.md 1.6）`)
        if (a?.cost !== undefined && !isCost(a.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
        if (a && typeof a === 'object') unknownKeys(Object.fromEntries(Object.entries(a).filter(([key]) => key !== 'before')), ENTRY_KEYS.alternation, path)
      })
  }
  return errors
}

/**
 * 構詞音變換成規則表的列：只在詞素交界適用的規則（docs/bcdp.md 1.3），與方言規則放在同一個 RuleSet、
 * 同一套 DP。查詢（表面）的 surface 對應到底層的 underlying，所以 source ＝ surface、target ＝ underlying，單向。
 * @param {MorphologySpec | undefined} spec
 * @returns {import('./rules.js').RuleTableRow[]}
 */
export function alternationRules(spec) {
  if (!spec?.alternations) return []
  const cost = spec.cost ?? DEFAULTS.cost
  return spec.alternations.map((a) => ({
    source: a.surface,
    target: a.underlying,
    weight: a.cost ?? cost,
    position: a.position ?? 'final',
    junction: true,
    bidirectional: false,
    category: ALTERNATION_CATEGORY,
  }))
}

/**
 * @typedef {object} Analyzer
 * @property {(word: string) => ReadonlyArray<Readonly<Analysis>>} analyze 去詞綴：所有可能的（詞幹, 步驟）；已正規化的輸入。
 *   結果有備忘，所以是深度凍結的（不能修改）
 * @property {() => void} clearCache 清掉 analyze 的備忘（量測冷快取時用）
 * @property {(stem: string, steps: MorphStep[]) => string} generate 還原詞綴
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
  // 構詞文法先展開成平面清單（每一項帶 parts 與 rank），之後與平面清單寫法完全相同
  if (isGrammarSpec(spec)) spec = expandGrammar(/** @type {any} */ (spec), normalize)
  const cost = spec.cost ?? DEFAULTS.cost
  const minStem = spec.minStem ?? DEFAULTS.minStem
  const maxSteps = spec.maxSteps ?? DEFAULTS.maxSteps
  const lemmaSpread = spec.lemmaSpread ?? DEFAULTS.lemmaSpread
  const vowels = new Set(Array.from(normalize(spec.vowels ?? DEFAULTS.vowels)))

  /** 說明複製一份再凍結：分析結果（有備忘）會引用它，但不能凍結呼叫端自己的物件 @param {Gloss | undefined} g */
  const glossOf = (g) => (g == null ? null : typeof g === 'string' ? g : Object.freeze({ ...g }))
  /**
   * 順序（rank）：成本與步驟數都相同的分析，說明選 rank 較前的（morph-search.js 的 finish）。構詞文法展開時
   * 已經給了（自由詞素在前、組合規則在後）；平面清單寫法依「前綴、後綴、中綴、重疊、環綴」各自的清單順序
   */
  const flat = /** @type {Array<{rank?: number}>} */ ([
    ...(spec.prefixes ?? []),
    ...(spec.suffixes ?? []),
    ...(spec.infixes ?? []),
    ...(spec.reduplication ?? []),
    ...(spec.circumfixes ?? []),
  ])
  const ranks = new Map(flat.map((e, k) => [e, e.rank ?? k]))
  /** 構詞文法的 parts（說明用）：原樣帶著、凍結 @param {{parts?: Part[]}} e */
  const partsOf = (e) => (e.parts ? { parts: Object.freeze(e.parts.map((x) => Object.freeze({ ...x }))) } : {})
  /** @param {AffixSpec[] | undefined} list */
  const affixes = (list) =>
    (list ?? [])
      .map((a) => Object.freeze({ form: normalize(a.form), gloss: glossOf(a.gloss), cost: a.cost ?? cost, rank: /** @type {number} */ (ranks.get(a)), ...partsOf(a) }))
      .filter((a) => a.form)
  const prefixes = affixes(spec.prefixes)
  const suffixes = affixes(spec.suffixes)
  const infixes = affixes(spec.infixes)
  const reduplication = (spec.reduplication ?? []).map((r) =>
    Object.freeze({
      pattern: r.pattern,
      gloss: glossOf(r.gloss),
      cost: r.cost ?? cost,
      rank: /** @type {number} */ (ranks.get(r)),
      ...partsOf(r),
    }),
  )
  /**
   * 環綴：kind 是左邊部分的種類，left 是它的形式（重疊時是型式）；左邊是中綴、重疊時，outer 是緊貼詞幹的前綴
   * （沒有時是空字串）；沒有後綴時 suffix 是空字串
   */
  const circumfixes = (spec.circumfixes ?? [])
    .map((c) => {
      const op = c.infix !== undefined ? 'infix' : c.reduplication !== undefined ? 'reduplication' : null
      return Object.freeze({
        kind: /** @type {'prefix' | 'infix' | 'reduplication'} */ (op ?? 'prefix'),
        left: op === 'infix' ? normalize(/** @type {string} */ (c.infix)) : op === 'reduplication' ? /** @type {string} */ (c.reduplication) : normalize(/** @type {string} */ (c.prefix)),
        outer: op && c.prefix !== undefined ? normalize(c.prefix) : '',
        suffix: c.suffix !== undefined ? normalize(c.suffix) : '',
        vowelStem: c.stemInitial === 'V',
        gloss: glossOf(c.gloss),
        cost: c.cost ?? cost,
        rank: /** @type {number} */ (ranks.get(c)),
        ...partsOf(c),
      })
    })
    // 正規化後仍至少兩個部分：前綴式要有後綴（或要求詞幹元音開頭）；中綴、重疊式要有前綴或後綴
    .filter((c) => c.left && (c.kind === 'prefix' ? c.suffix || c.vowelStem : c.outer || c.suffix))
  const alternations = (spec.alternations ?? []).map((a) => ({
    underlying: normalize(a.underlying),
    surface: normalize(a.surface),
    position: a.position ?? 'final',
    cost: a.cost ?? cost,
  }))

  /** @param {string} s */
  const len = (s) => Array.from(s).length
  /** 第一個、最後一個 code point @param {string} w */
  const firstChar = (w) => String.fromCodePoint(/** @type {number} */ (w.codePointAt(0)))
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
     * 步數預算與 BCDP 相同（docs/bcdp.md 1.2、1.6）：
     * - 前綴、後綴各自至多 maxSteps 個；另加至多一個非串接步驟（中綴、重疊或詞幹交替）
     * - 中綴與重疊位在「前綴鏈之內」的詞幹開頭：做了之後不能再剝前綴
     * - 重疊的模板只套用在詞幹上（不含後綴）：做了之後也不能再剝後綴
     * - 詞幹交替位在詞幹結尾、緊接最內層的後綴：做了之後不能再剝後綴；
     *   它是只在交界適用的規則，不另外佔用詞綴的步數
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
            visit(w.slice(p.form.length), [...steps, step('prefix', p.form, p.gloss, p.cost, p.parts)], total + p.cost, pre + 1, suf, op, preClosed, sufClosed)
          }
        }
      }
      if (!sufClosed && w) {
        for (const { affix: s, length } of suffixesByLast.get(lastChar(w)) ?? none) {
          if (!w.endsWith(s.form) || n - length < minStem) continue
          const rest = w.slice(0, w.length - s.form.length)
          const next = [...steps, step('suffix', s.form, s.gloss, s.cost, s.parts)]
          if (suf < maxSteps) visit(rest, next, total + s.cost, pre, suf + 1, op, preClosed, sufClosed)
          // 詞幹交替（構詞音變）只在剛剝掉的後綴前面發生；它是規則，不另外佔用詞綴的步數
          if (op || suf >= maxSteps) continue
          for (const a of alternations) {
            if (a.position === 'initial' || !rest.endsWith(a.surface)) continue
            const restored = rest.slice(0, rest.length - a.surface.length) + a.underlying
            if (len(restored) < minStem) continue
            visit(restored, [...next, step('alternation', `${a.underlying}>${a.surface}`, null, a.cost)], total + s.cost + a.cost, pre, suf + 1, true, preClosed, true)
          }
        }
      }
      // 環綴緊貼詞幹（最內層）：剝掉之後兩端都封閉；它算一個構詞步驟，不佔用前綴、後綴的步數，
      // 也是那一個非串接步驟（之後不能再有中綴或重疊）
      if (!op && !preClosed && !sufClosed && w) {
        for (const c of circumfixes) {
          if (!w.endsWith(c.suffix)) continue
          let rest = w.slice(0, w.length - c.suffix.length)
          // 左邊是中綴、重疊時，緊貼詞幹的前綴在它們外面：先剝掉
          if (c.outer) {
            if (!rest.startsWith(c.outer)) continue
            rest = rest.slice(c.outer.length)
          }
          if (c.kind === 'prefix') {
            if (!rest.startsWith(c.left) || len(rest) - len(c.left) < minStem) continue
            const stem = rest.slice(c.left.length)
            if (c.vowelStem && !vowels.has(firstChar(stem))) continue
            visit(stem, [...steps, circumfixStep(c, c.left)], total + c.cost, pre, suf, true, true, true)
          } else if (c.kind === 'infix') {
            const head = onset(rest)
            if (!rest.startsWith(c.left, head.length) || len(rest) - len(c.left) < minStem) continue
            const inner = head + rest.slice(head.length + c.left.length)
            if (onset(inner) !== head) continue
            visit(inner, [...steps, circumfixStep(c, c.left)], total + c.cost, pre, suf, true, true, true)
          } else {
            const rc = Array.from(rest)
            for (let k = 1; k <= rc.length - minStem; k++) {
              const t = template(/** @type {ReduplicationPattern} */ (c.left), rc, k)
              if (!t || !sameAsPrefix(rc, k, t)) continue
              visit(rc.slice(k).join(''), [...steps, circumfixStep(c, rc.slice(0, k).join(''))], total + c.cost, pre, suf, true, true, true)
            }
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
        visit(rest, [...steps, step('infix', x.form, x.gloss, x.cost, x.parts)], total + x.cost, pre, suf, true, true, sufClosed)
      }
      for (const r of reduplication) {
        // 重疊部分在最前面：試每一種切法 k，看剩下的詞幹 chars[k..) 套用同一模式是否正好得到 chars[0..k)。
        // 模板只看詞幹，所以重疊是最內層的步驟，剩下的就是詞幹（兩端都封閉）
        for (let k = 1; k <= n - minStem; k++) {
          const t = template(r.pattern, chars, k)
          if (!t || !sameAsPrefix(chars, k, t)) continue
          const red = chars.slice(0, k).join('')
          const base = chars.slice(k).join('')
          visit(base, [...steps, { type: 'reduplication', form: red, pattern: r.pattern, gloss: r.gloss, cost: r.cost, ...(r.parts ? { parts: r.parts } : {}) }], total + r.cost, pre, suf, true, true, true)
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
      } else if (s.type === 'circumfix' && s.left) {
        const l = s.left
        if (l.type === 'prefix') w = l.form + w
        else if (l.type === 'infix') {
          const head = onset(w)
          w = head + l.form + w.slice(head.length)
        } else w = (reduplicant(/** @type {ReduplicationPattern} */ (l.pattern), w) ?? '') + w
        w = (s.outer ?? '') + w + (s.suffix ?? '')
      } else if (s.type === 'alternation') {
        const [underlying, surface] = s.form.split('>')
        if (w.endsWith(underlying)) w = w.slice(0, w.length - underlying.length) + surface
      }
    }
    return w
  }

  return {
    analyze,
    clearCache: () => memo.clear(),
    generate,
    onset,
    reduplicant,
    reduplicantStems,
    // 深度凍結：analyze 的備忘依賴規格不變，而分析器內部直接使用這些陣列
    spec: Object.freeze({
      cost,
      minStem,
      maxSteps,
      lemmaSpread,
      vowels: [...vowels].join(''),
      prefixes: Object.freeze(prefixes),
      suffixes: Object.freeze(suffixes),
      infixes: Object.freeze(infixes),
      reduplication: Object.freeze(reduplication),
      circumfixes: Object.freeze(circumfixes),
      alternations: Object.freeze(alternations.map((a) => Object.freeze({ ...a }))),
    }),
  }
}

/**
 * @param {MorphStep['type']} type
 * @param {string} form
 * @param {Gloss} gloss
 * @param {number} cost
 * @param {ReadonlyArray<Part>} [parts] 構詞文法：由哪些詞素構成
 * @returns {MorphStep}
 */
function step(type, form, gloss, cost, parts) {
  return { type, form, gloss, cost, ...(parts ? { parts: /** @type {Part[]} */ (parts) } : {}) }
}

/**
 * 環綴的步驟：form 是「（前綴＋）左邊…後綴」，left 記下左邊部分的種類與實際的形式（重疊是實際的重疊部分），
 * outer 是中綴、重疊式外側緊貼詞幹的前綴。
 * @param {{kind: 'prefix' | 'infix' | 'reduplication', left: string, outer?: string, suffix: string, gloss: Gloss, cost: number, parts?: ReadonlyArray<Part>}} c
 * @param {string} leftForm
 * @returns {MorphStep}
 */
export function circumfixStep(c, leftForm) {
  return {
    type: 'circumfix',
    form: `${c.outer ? `${c.outer}+` : ''}${leftForm}${c.suffix ? `…${c.suffix}` : ''}`,
    left: c.kind === 'reduplication' ? { type: c.kind, form: leftForm, pattern: /** @type {ReduplicationPattern} */ (c.left) } : { type: c.kind, form: leftForm },
    ...(c.outer ? { outer: c.outer } : {}),
    suffix: c.suffix,
    gloss: c.gloss,
    cost: c.cost,
    ...(c.parts ? { parts: /** @type {Part[]} */ (c.parts) } : {}),
  }
}

/** @param {number} x */
function round(x) {
  return Math.round(x * 1e9) / 1e9
}
