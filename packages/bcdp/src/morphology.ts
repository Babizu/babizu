/**
 * @file 構詞規格：依語言設定檔的 `morphology` 規格，檢查、正規化詞綴與重疊模板，供構詞搜尋 BCDP（morph-search）使用。
 *
 * - `spec`：正規化後的規格（詞綴、環綴、重疊型式、構詞音變，各自帶成本與說明的順序）；
 * - `onset`、`reduplicant`、`reduplicantStems`：中綴位置與重疊模板，BCDP 在查詢上還原中綴、重疊時用；
 * - `generate(stem, steps)`：還原詞綴。把詞幹依 BCDP 命中的步驟加回詞綴，得到底層的詞形（測試用它檢查分析）。
 *
 * 去詞綴只有一套演算法：BCDP。詞根在詞庫中時走訪詞圖；詞根不在詞庫中（虛擬詞根）時，
 * 同一個 DP 的交界列直接給出「字面的開放詞幹」（docs/bcdp.md 第 10 節）。
 * 規格是宣告式的純資料，概念上對應有限狀態構詞（FST）中的詞綴槽位、中綴、重疊與詞幹交替，但不編譯成轉錄器。
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
 * 規格也可以用構詞文法寫（詞素與組合規則，grammar.ts）：載入時展開成上面這種平面清單，之後完全相同。
 *
 * 完整說明見 docs/language-profile.md 的「構詞」一節與 docs/morph-grammar.md。
 */

import { expandGrammar, isGrammarSpec, validateGrammar, type ExpandedSpec, type Expansion, type GrammarSpec } from './grammar.ts'
import {
  ALTERNATION_CATEGORY,
  DEFAULTS,
  GLIDE_PATTERNS,
  validateFlatMorphology,
  type AffixSpec,
  type Gloss,
  type MorphologySpec,
  type MorphStep,
  type Part,
  type ReduplicationPattern,
  type SyllableCost,
} from './morphology-spec.ts'
import type { RuleTableRow } from './rules.ts'

export { ALTERNATION_CATEGORY, GLIDE_PATTERNS, REDUPLICATION_PATTERNS } from './morphology-spec.ts'
export type {
  AffixSpec,
  AlternationSpec,
  CircumfixSpec,
  Gloss,
  MorphologySpec,
  MorphStep,
  Part,
  ReduplicationPattern,
  ReduplicationSpec,
} from './morphology-spec.ts'

/** 正規化後的詞綴（凍結） */
export interface NormalizedAffix {
  readonly form: string
  readonly gloss: Gloss
  readonly cost: number
  /** 說明的順序：成本與步驟數都相同的分析，說明選 rank 較前的 */
  readonly rank: number
  readonly parts?: ReadonlyArray<Readonly<Part>>
}

/** 正規化後的重疊 */
export interface NormalizedReduplication {
  readonly pattern: ReduplicationPattern
  readonly gloss: Gloss
  readonly cost: number
  readonly rank: number
  readonly parts?: ReadonlyArray<Readonly<Part>>
}

/**
 * 正規化後的環綴：kind 是左邊部分的種類，left 是它的形式（重疊時是型式）；左邊是中綴、重疊時，outer 是緊貼詞幹的前綴
 * （沒有時是空字串）；沒有後綴時 suffix 是空字串；vowelStem：詞幹必須以元音開頭
 */
export interface NormalizedCircumfix {
  readonly kind: 'prefix' | 'infix' | 'reduplication'
  readonly left: string
  readonly outer: string
  readonly suffix: string
  readonly vowelStem: boolean
  readonly gloss: Gloss
  readonly cost: number
  readonly rank: number
  readonly parts?: ReadonlyArray<Readonly<Part>>
}

/** 正規化後的構詞音變 */
export interface NormalizedAlternation {
  readonly underlying: string
  readonly surface: string
  readonly position: 'final' | 'initial' | 'any'
  readonly cost: number
}

/** 正規化後的規格（深度凍結；BCDP 直接使用這些陣列） */
export interface AnalyzerSpec {
  readonly cost: number
  readonly minStem: number
  readonly maxSteps: number
  readonly lemmaSpread: number
  readonly virtualRootLengthCost: number
  /** 兩種詞根各一張表：第 k 格是 k 個音節的成本，最後一格也套用到更多音節；沒有設定時是空表 */
  readonly rootSyllableCost: { readonly entry: readonly number[]; readonly other: readonly number[] }
  readonly vowels: string
  readonly glides: string
  readonly prefixes: readonly NormalizedAffix[]
  readonly suffixes: readonly NormalizedAffix[]
  readonly infixes: readonly NormalizedAffix[]
  readonly reduplication: readonly NormalizedReduplication[]
  readonly circumfixes: readonly NormalizedCircumfix[]
  readonly alternations: readonly NormalizedAlternation[]
}

/** 構詞規格與 BCDP 要用到的模板（去詞綴本身是 BCDP，morph-search） */
export interface Analyzer {
  /** 還原詞綴 */
  generate: (stem: string, steps: MorphStep[]) => string
  /** 詞首的輔音（群） */
  onset: (w: string) => string
  /** 詞幹 base 套用重疊模式時前面要加的字串 */
  reduplicant: (pattern: ReduplicationPattern, base: string) => string | null
  /** 重疊部分後面的字元 rest 中，哪些長度 L 的開頭 rest[0..L) 當作詞幹時，重疊部分正好是 red（遞增） */
  reduplicantStems: (pattern: ReduplicationPattern, rest: string[], red: string) => number[]
  /** 正規化後的規格 */
  spec: AnalyzerSpec
}

/**
 * 檢查規格，回傳錯誤訊息清單（空陣列表示沒有錯誤）。構詞文法寫法（morphemes、constructions）由 grammar.ts 檢查，
 * 平面清單寫法由 morphology-spec.ts 檢查。
 */
export function validateMorphology(spec: unknown): string[] {
  if (spec === undefined) return []
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['morphology 必須是物件']
  const s = spec as Record<string, unknown>
  return isGrammarSpec(s) ? validateGrammar(s) : validateFlatMorphology(s)
}

/**
 * 構詞音變換成規則表的列：只在詞素交界適用的規則（docs/bcdp.md 1.3），與方言規則放在同一個 RuleSet、
 * 同一套 DP。查詢（表面）的 surface 對應到底層的 underlying，所以 source ＝ surface、target ＝ underlying，單向。
 */
export function alternationRules(spec: Pick<MorphologySpec, 'alternations' | 'cost'> | undefined): RuleTableRow[] {
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
 * 依規格建立構詞分析器：正規化的規格（normalizeSpec），加上中綴位置與重疊模板（createTemplates）。
 * @param input 平面清單或構詞文法寫法的規格
 * @param normalize 詞綴與輸入的正規化（應與搜尋鍵相同）
 */
export function createAnalyzer(input: MorphologySpec | GrammarSpec, normalize: (s: string) => string = (s) => s): Analyzer {
  const spec = normalizeSpec(input, normalize)
  const templates = createTemplates(spec)
  return {
    generate: (stem, steps) => generate(stem, steps, templates),
    ...templates,
    spec,
  }
}

/**
 * 檢查規格；構詞文法先展開成平面清單；再正規化：詞綴經過 normalize、補上預設值與成本、記下說明的順序（rank），
 * 正規化後不足兩個部分的環綴去掉。結果深度凍結：BCDP（morph-search）直接使用這些陣列。
 */
function normalizeSpec(input: MorphologySpec | GrammarSpec, normalize: (s: string) => string): AnalyzerSpec {
  const errors = validateMorphology(input)
  if (errors.length) throw new TypeError(`構詞規格格式錯誤：\n- ${errors.join('\n- ')}`)
  // 構詞文法先展開成平面清單（每一項帶 parts 與 rank），之後與平面清單寫法完全相同
  const spec: ExpandedSpec = isGrammarSpec(input) ? expandGrammar(input, normalize) : (input as MorphologySpec)
  const cost = spec.cost ?? DEFAULTS.cost
  const minStem = spec.minStem ?? DEFAULTS.minStem
  const maxSteps = spec.maxSteps ?? DEFAULTS.maxSteps
  const lemmaSpread = spec.lemmaSpread ?? DEFAULTS.lemmaSpread
  const virtualRootLengthCost = spec.virtualRootLengthCost ?? DEFAULTS.virtualRootLengthCost
  const vowels = new Set(Array.from(normalize(spec.vowels ?? DEFAULTS.vowels)))
  // 音節數 → 成本的表：第 k 格是 k 個音節的成本，最後一格也套用到更多音節；沒有設定時是空表
  const rootSyllableCost = syllableCostTable(spec.rootSyllableCost)
  const glides = new Set(Array.from(normalize(spec.glides ?? '')))

  /** 說明複製一份再凍結：分析結果（有備忘）會引用它，但不能凍結呼叫端自己的物件 */
  const glossOf = (g: Gloss | undefined): Gloss => (g == null ? null : typeof g === 'string' ? g : Object.freeze({ ...g }))
  /**
   * 順序（rank）：成本與步驟數都相同的分析，說明選 rank 較前的（morph-search 的 finish）。構詞文法展開時
   * 已經給了（自由詞素在前、組合規則在後）；平面清單寫法依「前綴、後綴、中綴、重疊、環綴」各自的清單順序
   */
  const flat: Expansion[] = [
    ...(spec.prefixes ?? []),
    ...(spec.suffixes ?? []),
    ...(spec.infixes ?? []),
    ...(spec.reduplication ?? []),
    ...(spec.circumfixes ?? []),
  ]
  const ranks = new Map(flat.map((e, k) => [e, e.rank ?? k]))
  /** 構詞文法的 parts（說明用）：原樣帶著、凍結 */
  const partsOf = (e: Expansion) => (e.parts ? { parts: Object.freeze(e.parts.map((x) => Object.freeze({ ...x }))) } : {})
  const affixes = (list: Array<AffixSpec & Expansion> | undefined): NormalizedAffix[] =>
    (list ?? [])
      .map((a) => Object.freeze({ form: normalize(a.form), gloss: glossOf(a.gloss), cost: a.cost ?? cost, rank: ranks.get(a) as number, ...partsOf(a) }))
      .filter((a) => a.form)
  const prefixes = affixes(spec.prefixes)
  const suffixes = affixes(spec.suffixes)
  const infixes = affixes(spec.infixes)
  const reduplication = (spec.reduplication ?? []).map(
    (r): NormalizedReduplication =>
      Object.freeze({
        pattern: r.pattern,
        gloss: glossOf(r.gloss),
        cost: r.cost ?? cost,
        rank: ranks.get(r) as number,
        ...partsOf(r),
      }),
  )
  const circumfixes = (spec.circumfixes ?? [])
    .map((c): NormalizedCircumfix => {
      const op = c.infix !== undefined ? 'infix' : c.reduplication !== undefined ? 'reduplication' : null
      return Object.freeze({
        kind: op ?? 'prefix',
        left: op === 'infix' ? normalize(c.infix as string) : op === 'reduplication' ? (c.reduplication as string) : normalize(c.prefix as string),
        outer: op && c.prefix !== undefined ? normalize(c.prefix) : '',
        suffix: c.suffix !== undefined ? normalize(c.suffix) : '',
        vowelStem: c.stemInitial === 'V',
        gloss: glossOf(c.gloss),
        cost: c.cost ?? cost,
        rank: ranks.get(c) as number,
        ...partsOf(c),
      })
    })
    // 正規化後仍至少兩個部分：前綴式要有後綴（或要求詞幹元音開頭）；中綴、重疊式要有前綴或後綴
    .filter((c) => c.left && (c.kind === 'prefix' ? c.suffix || c.vowelStem : c.outer || c.suffix))
  const alternations = (spec.alternations ?? []).map(
    (a): NormalizedAlternation => ({
      underlying: normalize(a.underlying),
      surface: normalize(a.surface),
      position: a.position ?? 'final',
      cost: a.cost ?? cost,
    }),
  )
  return Object.freeze({
    cost,
    minStem,
    maxSteps,
    lemmaSpread,
    virtualRootLengthCost,
    rootSyllableCost: Object.freeze({ entry: Object.freeze(rootSyllableCost.entry), other: Object.freeze(rootSyllableCost.other) }),
    vowels: [...vowels].join(''),
    glides: [...glides].join(''),
    prefixes: Object.freeze(prefixes),
    suffixes: Object.freeze(suffixes),
    infixes: Object.freeze(infixes),
    reduplication: Object.freeze(reduplication),
    circumfixes: Object.freeze(circumfixes),
    alternations: Object.freeze(alternations.map((a) => Object.freeze({ ...a }))),
  })
}

/**
 * 中綴位置與重疊模板：只依規格的元音與滑音（模板本身與語言無關，見 ReduplicationPattern）。
 * @param spec 正規化後的規格
 */
function createTemplates(spec: Pick<AnalyzerSpec, 'vowels' | 'glides'>): Pick<Analyzer, 'onset' | 'reduplicant' | 'reduplicantStems'> {
  const vowels = new Set(Array.from(spec.vowels))
  const glides = new Set(Array.from(spec.glides))
  const len = (s: string) => Array.from(s).length
  /** 詞首的輔音（群）：第一個元音之前的所有字元 */
  const onset = (w: string) => {
    const chars = Array.from(w)
    let k = 0
    while (k < chars.length && !vowels.has(chars[k])) k++
    return chars.slice(0, k).join('')
  }
  /**
   * 重疊部分：pattern 套用在詞幹 base 上時，前面要加的字串（不適用時為 null）。
   * 模板的定義見 ReduplicationPattern。重疊複製的是 base 本身的形式：搜尋時 base 取自查詢，
   * 所以複製的是查詢的（方言）形式（docs/bcdp.md 1.4）。
   */
  const reduplicant = (pattern: ReduplicationPattern, base: string): string | null => {
    if (pattern === 'full') return base
    const chars = Array.from(base)
    const t = template(pattern, chars, 0)
    return t && chars.slice(0, t.end).join('') + t.extra
  }

  /**
   * 模板的本體：套用在 chars[from..) 上的結果，表示成「chars[from..end) 再接 extra」（extra 是空字串或一個字元），
   * 不適用時為 null。直接在字元陣列上計算、不配置字串。
   */
  const template = (pattern: ReduplicationPattern, chars: string[], from: number): { end: number; extra: string } | null => {
    const n = chars.length
    if (pattern === 'full') return { end: n, extra: '' }
    let v1 = from
    while (v1 < n && !vowels.has(chars[v1])) v1++ // 第一個元音（沒有時 v1 ＝ n）
    if (pattern === 'Ca') return { end: v1, extra: 'a' }
    if (v1 === n) return null
    if (pattern === 'CV') return { end: v1 + 1, extra: '' }
    if (pattern === 'CVV') return { end: v1 + 1, extra: chars[v1] }
    let k = v1
    while (k < n && vowels.has(chars[k])) k++ // 第一個元音核結束
    if (pattern === 'CGV' || pattern === 'CVG') {
      // 含滑音的音節：元音核正好兩個不同的元音；CGV 第一個是滑音，CVG 第二個是滑音而第一個不是
      if (k - v1 !== 2 || chars[v1] === chars[v1 + 1]) return null
      const onglide = glides.has(chars[v1])
      const ok = pattern === 'CGV' ? onglide : !onglide && glides.has(chars[v1 + 1])
      return ok ? { end: k, extra: '' } : null
    }
    // CVCV／CVCVC：第一個元音核之後，跳過輔音，找第二個元音核
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
   * L ≥ |w| 時 reduplicant(pattern, rest[0..L)) ＝ w（穩定引理，以 test/morphology.test.ts 的
   * 性質測試檢查）。只有 L < |w| 需要逐一計算；
   * w 為 null（沒有元音，或只有一個音節）時，較短的開頭也一定是 null；例外是 CGV、CVG：元音核有三個以上的元音時
   *   不適用，但截在第二個元音之後的開頭（L ＝ 第一個元音的位置 ＋ 2）元音核正好兩個，可能適用，另外檢查這一個長度。
   * full 的重疊部分就是詞幹本身，只可能是 L ＝ |red|。
   */
  const reduplicantStems = (pattern: ReduplicationPattern, rest: string[], red: string): number[] => {
    if (pattern === 'full') {
      const l = len(red)
      return l <= rest.length && rest.slice(0, l).join('') === red ? [l] : []
    }
    const whole = reduplicant(pattern, rest.join(''))
    if (whole === null) {
      if (!(GLIDE_PATTERNS as readonly string[]).includes(pattern)) return []
      let v1 = 0
      while (v1 < rest.length && !vowels.has(rest[v1])) v1++
      const l = v1 + 2
      return l <= rest.length && reduplicant(pattern, rest.slice(0, l).join('')) === red ? [l] : []
    }
    const stable = len(whole)
    const out: number[] = []
    for (let l = 1; l < Math.min(stable, rest.length + 1); l++) {
      if (reduplicant(pattern, rest.slice(0, l).join('')) === red) out.push(l)
    }
    if (whole === red) for (let l = stable; l <= rest.length; l++) out.push(l)
    return out
  }

  return { onset, reduplicant, reduplicantStems }
}

/**
 * 還原詞綴，得到底層的詞形（構詞音變不在步驟裡：它是交界上的規則，在 BCDP 的對齊中）。
 * 用來檢查 BCDP 的分析（測試由步驟重建底層字串，與詞形比對）。
 *
 * 步驟是 BCDP 命中的形狀：前綴（由外而內）、包覆單位（中綴、重疊或環綴，緊貼詞幹，至多一個）、後綴（由外而內）。
 * 包覆單位一定是最內層，所以先套它（重疊的模板只看詞幹本身），再由內而外接上後綴與前綴。
 */
function generate(stem: string, steps: MorphStep[], { onset, reduplicant }: Pick<Analyzer, 'onset' | 'reduplicant'>): string {
  let w = stem
  for (const s of steps) {
    if (s.type === 'infix') {
      const head = onset(w)
      w = head + s.form + w.slice(head.length)
    } else if (s.type === 'reduplication') {
      w = (reduplicant(s.pattern as ReduplicationPattern, w) ?? '') + w
    } else if (s.type === 'circumfix' && s.left) {
      const l = s.left
      if (l.type === 'prefix') w = l.form + w
      else if (l.type === 'infix') {
        const head = onset(w)
        w = head + l.form + w.slice(head.length)
      } else w = (reduplicant(l.pattern as ReduplicationPattern, w) ?? '') + w
      w = (s.outer ?? '') + w + (s.suffix ?? '')
    }
  }
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === 'suffix') w = w + steps[i].form
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === 'prefix') w = steps[i].form + w
  return w
}

/**
 * 詞根音節數的成本表（rootSyllableCost 的正規化）：兩種詞根（entry 辭典的詞條或標為詞根、other 其他）各一張表，
 * 第 k 格是 k 個音節的成本，沒列的音節數是 0，最後一格也套用到更多音節。只寫一個數字的音節數兩種相同。沒有設定時是空表。
 */
function syllableCostTable(table: Record<string, SyllableCost> | undefined): { entry: number[]; other: number[] } {
  const keys = table ? Object.keys(table).map(Number) : []
  if (!table || !keys.length) return { entry: [], other: [] }
  const max = Math.max(...keys)
  const column = (kind: 'entry' | 'other') =>
    Array.from({ length: max + 1 }, (_, k) => {
      const v = table[String(k)]
      return v === undefined ? 0 : typeof v === 'number' ? v : v[kind]
    })
  return { entry: column('entry'), other: column('other') }
}

/**
 * 詞根依音節數的成本（詞根形狀的先驗，rootSyllableCost）：音節數是詞根中元音字母的數目，
 * 超過表的長度時用最後一格。entry：詞根是辭典的詞條或標為詞根（呼叫端判斷；虛擬詞根是 false）。沒有設定時永遠是 0。
 * @param spec 正規化後的規格（Analyzer.spec）
 */
export function rootCostOf(spec: Pick<AnalyzerSpec, 'rootSyllableCost' | 'vowels'>): (root: string, isEntry?: boolean) => number {
  const { entry = [], other = [] } = spec.rootSyllableCost ?? {}
  if (!entry.length) return () => 0
  const vowels = new Set(Array.from(spec.vowels))
  return (root, isEntry = true) => {
    let n = 0
    for (const c of root) if (vowels.has(c)) n++
    const table = isEntry ? entry : other
    return table[Math.min(n, table.length - 1)]
  }
}

/**
 * 環綴的步驟：form 是「（前綴＋）左邊…後綴」，left 記下左邊部分的種類與實際的形式（重疊是實際的重疊部分），
 * outer 是中綴、重疊式外側緊貼詞幹的前綴。
 */
export function circumfixStep(c: Pick<NormalizedCircumfix, 'kind' | 'left' | 'suffix' | 'gloss' | 'cost' | 'parts'> & { outer?: string }, leftForm: string): MorphStep {
  return {
    type: 'circumfix',
    form: `${c.outer ? `${c.outer}+` : ''}${leftForm}${c.suffix ? `…${c.suffix}` : ''}`,
    left: c.kind === 'reduplication' ? { type: c.kind, form: leftForm, pattern: c.left as ReduplicationPattern } : { type: c.kind, form: leftForm },
    ...(c.outer ? { outer: c.outer } : {}),
    suffix: c.suffix,
    gloss: c.gloss,
    cost: c.cost,
    ...(c.parts ? { parts: c.parts } : {}),
  }
}
