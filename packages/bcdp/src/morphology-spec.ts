/**
 * @file 構詞規格的型別、預設值與平面清單寫法的檢查。
 *
 * 獨立成一個檔，讓 grammar.ts（構詞文法）與 morphology.ts（分析器）都依賴它，而不互相依賴：
 * 構詞文法展開後的平面清單與直接寫的平面清單用同一套檢查（validateFlatMorphology）。
 */

/** 詞綴說明（可依介面語系提供） */
export type Gloss = string | Record<string, string> | null

export interface AffixSpec {
  /** 詞綴（不含連字號；會經過與搜尋鍵相同的正規化） */
  form: string
  /** 語法說明，例如 `{ "zh-TW": "主事焦點", "en": "AF" }` */
  gloss?: Gloss
  /** 剝除這個詞綴的成本（預設用規格的 `cost`） */
  cost?: number
}

/** 由構詞文法展開的項目帶著它由哪些詞素構成（推導順序中的一個；說明用） */
export interface Part {
  /** 詞素 id */
  id: string
  type: 'prefix' | 'suffix' | 'infix' | 'reduplication'
  /** 形式（重疊是型式） */
  form: string
  gloss: Gloss
}

/** 支援的重疊型式 */
export const REDUPLICATION_PATTERNS = Object.freeze(['Ca', 'CV', 'CVV', 'CGV', 'CVG', 'CVCV', 'CVCVC', 'full'] as const)
/** 要用到 `glides`（可當滑音的元音）的重疊型式 */
export const GLIDE_PATTERNS = Object.freeze(['CGV', 'CVG'] as const)

/**
 * 重疊的型式（docs/bcdp.md 1.6）。重疊部分放在詞幹前面，由詞幹 base 依模板產生：
 * - Ca：首輔音（群）＋ a（`da~dius`、`la~luzuk`）
 * - CV：首輔音＋第一個元音（`ki~kiliw`、`du~dusa`）
 * - CVV：首輔音＋第一個元音重複兩次，即元音加長（`dee~depex`、`kii~kita`）
 * - CGV、CVG：首輔音＋含滑音的第一個元音核，也就是一個帶滑音的音節（使用者心理上的一個 CV）。元音核正好兩個元音、
 *   兩者不同，其中一個是規格 `glides` 列出的可當滑音的元音：
 *   - CGV（前滑音）：第一個元音是滑音（`ria~riak` /rja/、`tia~tianak`、`rua~ruaday`）；兩個都是滑音的也歸這裡（`ziu~ziux` /zju/）
 *   - CVG（後滑音）：第二個元音是滑音、第一個不是（`bai~bair` /baj/、`tau~taukua`、`heu~heul`）
 *   元音核只有一個元音時不適用（那就是 CV）；兩個模板不會同時適用
 * - CVCV：base 從頭到第二個元音核為止，即「兩音節、去掉韻尾」（`kipu~kipud-i`、`luba~lubahing`）
 * - CVCVC：CVCV 再加上其後連續的輔音，即「兩音節、含韻尾」（噶哈巫語 `kudung~kudung`）
 * - full：整個詞幹重疊
 * 「首輔音」是第一個元音之前的字元；「元音核」是連續的元音字元（`aa`、`au` 算一個）。
 * 不在 `vowels` 中的字元（包括滑音 y、w 與喉塞音 '）都當作輔音。元音由規格決定，所以模板與語言無關。
 * 模板只套用在**詞幹**上，不含後綴：`kipu~kipud-i` 的重疊部分由 kipud 產生（docs/bcdp.md 1.4）。
 */
export type ReduplicationPattern = (typeof REDUPLICATION_PATTERNS)[number]

/** 是否為（要用到滑音的）重疊型式；接受任何值，供檢查設定檔使用 */
export const isReduplicationPattern = (v: unknown): v is ReduplicationPattern => (REDUPLICATION_PATTERNS as readonly unknown[]).includes(v)
export const isGlidePattern = (v: unknown): boolean => (GLIDE_PATTERNS as readonly unknown[]).includes(v)

export interface ReduplicationSpec {
  pattern: ReduplicationPattern
  gloss?: Gloss
  cost?: number
}

/**
 * 構詞音變：只在詞素交界發生的音變，例如詞幹末的 t 在後綴前寫成 d（`bitut` ＋ `-un` → `bitudun`）。
 * 它是一條只在交界適用的規則（docs/bcdp.md 1.3），與方言規則同一套 DP：
 * 查詢（表面）的 surface 對應到底層（詞庫、詞綴）的 underlying。
 */
export interface AlternationSpec {
  /** 例如 `t`（可以是空字串：交界上的增生） */
  underlying: string
  /** 例如 `d`（可以是空字串：交界上的脫落） */
  surface: string
  /**
   * underlying 在交界的哪一側（預設 final）：final ＝ 交界前那個詞素的結尾（詞幹末的 t），
   * initial ＝ 交界後那個詞素的開頭，any ＝ 任一側
   */
  position?: 'final' | 'initial' | 'any'
  cost?: number
}

/**
 * 環綴（包覆單位）：緊貼詞幹的幾個部分一起出現，合起來算**一個**構詞步驟
 * （`ta-kita-aw`、`m<in>…-an`、`da~daux-ay`、`m<a>-usa`、`m<a>-usa-ay`）。三個部分中至少要有兩個。
 *
 * 環綴緊貼著詞幹：前綴是最內層的前綴，中綴、重疊在詞幹上，後綴是最內層的後綴，
 * 其他詞綴只能加在它們外面（docs/bcdp.md 1.2）。前綴 ＋ 中綴（m ＋ <a>）與「中綴先加在詞幹上、再加前綴」
 * 表面相同（docs/morph-grammar.md 第 2 節），所以中綴一律在詞幹上還原。
 */
export interface CircumfixSpec {
  /** 緊貼詞幹的前綴，例如 `ta`（`ta-…-aw`）、`m`（`m<a>-`） */
  prefix?: string
  /** 詞幹上的中綴，例如 `in`（`<in>…-an`） */
  infix?: string
  /** 詞幹上的重疊型式，例如 `Ca`（`Ca-…-ay`）；與 infix 至多一個 */
  reduplication?: ReduplicationPattern
  /** 緊貼詞幹的後綴，例如 `aw` */
  suffix?: string
  /**
   * 詞幹必須以元音開頭（只用於只有前綴、沒有中綴與重疊的環綴）。
   * 構詞文法展開時產生：只有輔音的前綴插入中綴（m ＋ <a>），在元音開頭的詞根上就是串接的 ma·usa
   * （docs/morph-grammar.md 第 2 節）；這時可以沒有後綴（緊貼詞幹的前綴）
   */
  stemInitial?: 'V'
  gloss?: Gloss
  cost?: number
}

/** 詞根依音節數另加的成本的一格：一個數字（兩種詞根相同），或分 entry、other 兩種詞根 */
export type SyllableCost = number | { entry: number; other: number }

/** 語言設定檔的 `morphology` 區段（平面清單寫法） */
export interface MorphologySpec {
  /** 每個構詞步驟的預設成本（預設 0.3） */
  cost?: number
  /** 詞根（詞庫詞）最短長度（code point；預設 3）；查詢至少要多一個字元 */
  minStem?: number
  /** 前綴、後綴各自最多幾個（預設 3；另加至多一個包覆單位：中綴、重疊或環綴；見 docs/bcdp.md 1.6） */
  maxSteps?: number
  /** 構詞命中只保留成本在「最佳 ＋ lemmaSpread」之內的詞，控制候選數（預設 0.6） */
  lemmaSpread?: number
  /**
   * 詞庫外的詞根（虛擬詞根）每個字元的成本（預設 0.03）：詞庫中的詞根只要指出是哪一個，
   * 詞庫外的要逐字寫出來，所以越長越貴（借用最小描述長度的直覺的長度懲罰，每個詞各自計算；docs/bcdp.md 第 10 節）。
   * 預設值以巴宰–噶哈巫語的資料校準
   */
  virtualRootLengthCost?: number
  /**
   * 詞根依音節數另加的成本（詞根形狀的先驗）：鍵是音節數，值是成本；沒列的音節數是 0，最大的鍵也套用到更多音節。
   * 值也可以分兩種詞根：`entry` 是辭典的詞條或標為詞根的（任何記錄的詞形、異寫、變體，或衍生詞標註的詞根），
   * `other` 是其他的（只出現在例句、片語中的詞，與詞庫外的虛擬詞根）。
   * 例：{"1": 0.5, "2": {"entry": 0, "other": 0.2}, "3": 0.1, "4": 0.2}。音節數是詞根中 `vowels` 的字母數。
   * 南島語的詞根多半是兩個音節，而 BCDP 傾向把詞拆到最短的詞根或停在較長的中間詞幹，這個先驗用來平衡（docs/bcdp.md 1.6 第 9 項）。
   * 虛擬詞根在 virtualRootLengthCost 之外另加 `other` 的成本
   */
  rootSyllableCost?: Record<string, SyllableCost>
  /** 元音字母（決定「首輔音」「首元音」與中綴位置；預設 'aeiouéə'） */
  vowels?: string
  /**
   * 可以當滑音的元音（`vowels` 的子集；巴宰語是 `iu`）。重疊型式 CGV、CVG 要用到，
   * 框架不預設：哪些元音會念成滑音是語言的知識
   */
  glides?: string
  prefixes?: AffixSpec[]
  suffixes?: AffixSpec[]
  /** 插在詞幹首輔音（群）之後、首元音之前；元音開頭的詞幹則在最前面 */
  infixes?: AffixSpec[]
  reduplication?: ReduplicationSpec[]
  circumfixes?: CircumfixSpec[]
  alternations?: AlternationSpec[]
}

/** 一個構詞步驟（由外而內，也就是剝除的順序） */
export interface MorphStep {
  type: 'prefix' | 'suffix' | 'infix' | 'reduplication' | 'circumfix'
  /** 詞綴；重疊為實際的重疊部分；環綴為 `左邊…後綴` */
  form: string
  /** 重疊的型式 */
  pattern?: ReduplicationPattern
  /** 環綴左邊的部分：前綴，或詞幹上的中綴、重疊（重疊的 form 是實際的重疊部分） */
  left?: { type: 'prefix' | 'infix' | 'reduplication'; form: string; pattern?: ReduplicationPattern }
  /** 環綴的左邊是中綴或重疊時，緊貼詞幹的前綴（m<a>- 的 m） */
  outer?: string
  /** 環綴的後綴（可以是空字串：沒有後綴的環綴） */
  suffix?: string
  gloss: Gloss
  cost: number
  /** 構詞文法：由哪些詞素構成（推導順序） */
  parts?: readonly Part[]
}

/** 規格各欄位的預設值 */
export const DEFAULTS = Object.freeze({
  cost: 0.3,
  minStem: 3,
  maxSteps: 3,
  lemmaSpread: 0.6,
  virtualRootLengthCost: 0.03,
  vowels: 'aeiouéə',
})

/** 構詞音變在規則表中的分類名稱（說明中顯示為構詞音變，而不是方言差異） */
export const ALTERNATION_CATEGORY = '構詞音變'

/** 已移除的欄位與原因：舊的設定檔會得到明確的錯誤訊息，而不是默默被忽略 */
const REMOVED_KEYS: Record<string, string> = {
  lemmaDistance: '已移除：音變改以整個詞計算（規則可以跨越詞素交界），只受總成本上限與 lemmaSpread 限制（docs/bcdp.md 1.6）',
  affixDistance: '已移除：音變改以整個詞計算（規則可以跨越詞素交界），只受總成本上限與 lemmaSpread 限制（docs/bcdp.md 1.6）',
}
const POSITIONS = new Set(['final', 'initial', 'any'])

/** 規格頂層允許的欄位（拼錯的欄位會被默默忽略，所以列為錯誤） */
const SPEC_KEYS = new Set([
  'cost',
  'minStem',
  'maxSteps',
  'lemmaSpread',
  'virtualRootLengthCost',
  'rootSyllableCost',
  'vowels',
  'glides',
  'prefixes',
  'suffixes',
  'infixes',
  'reduplication',
  'circumfixes',
  'alternations',
])
/** 各種項目允許的欄位；ref（出處）與 note（說明）供語言設定檔記錄依據，搜尋不使用 */
const ENTRY_KEYS = {
  affix: new Set(['form', 'gloss', 'cost', 'ref', 'note']),
  reduplication: new Set(['pattern', 'gloss', 'cost', 'ref', 'note']),
  alternation: new Set(['underlying', 'surface', 'position', 'cost', 'ref', 'note']),
  circumfix: new Set(['prefix', 'infix', 'reduplication', 'suffix', 'stemInitial', 'gloss', 'cost', 'ref', 'note']),
}
/** maxSteps 的上限：前綴、後綴各自最多這麼多層（圖表以 Int8Array 記槽位，也避免指數級的列舉） */
const MAX_STEPS_LIMIT = 10
const hasSpace = (s: string) => /\s/u.test(s)

/**
 * 檢查平面清單寫法的規格（prefixes、suffixes…），回傳錯誤訊息清單（空陣列表示沒有錯誤）。
 * 構詞文法寫法由 grammar.ts 的 validateGrammar 檢查，它把與平面清單共用的欄位（cost、alternations…）交給這裡；
 * 兩種寫法的分派在 morphology.ts 的 validateMorphology。
 *
 * 除了型別與範圍，也檢查「會讓搜尋默默出錯」的情況：拼錯的欄位、詞綴含空白
 * （詞綴不跨越詞邊界，見 docs/bcdp.md 1.6）、非有限的成本。
 * @param s 規格（物件）。內容還沒檢查過，所以各欄位以 any 讀取
 */
export function validateFlatMorphology(s: Record<string, any>): string[] {
  const errors: string[] = []
  const isCost = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const unknownKeys = (entry: unknown, allowed: Set<string>, path: string) => {
    if (!entry || typeof entry !== 'object') return
    for (const key of Object.keys(entry)) if (!allowed.has(key)) errors.push(`${path}.${key} 是未知的欄位`)
  }

  for (const key of Object.keys(s)) {
    if (key in REMOVED_KEYS) errors.push(`morphology.${key} ${REMOVED_KEYS[key]}`)
    else if (!SPEC_KEYS.has(key)) errors.push(`morphology.${key} 是未知的欄位`)
  }
  for (const key of ['cost', 'lemmaSpread', 'virtualRootLengthCost']) {
    if (s[key] !== undefined && !isCost(s[key])) errors.push(`morphology.${key} 必須是非負的有限數`)
  }
  if (s.minStem !== undefined && !(Number.isInteger(s.minStem) && s.minStem >= 1)) errors.push('morphology.minStem 必須是 ≥ 1 的整數')
  if (s.rootSyllableCost !== undefined) {
    const t = s.rootSyllableCost
    if (!t || typeof t !== 'object' || Array.isArray(t)) errors.push('morphology.rootSyllableCost 必須是物件（音節數 → 成本）')
    else {
      for (const [k, v] of Object.entries(t)) {
        if (!/^[1-9]\d?$/u.test(k)) errors.push(`morphology.rootSyllableCost 的鍵「${k}」必須是 1–99 的音節數`)
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          for (const key of Object.keys(v)) if (key !== 'entry' && key !== 'other') errors.push(`morphology.rootSyllableCost.${k}.${key} 是未知的欄位（只有 entry、other）`)
          for (const key of ['entry', 'other']) if (!isCost((v as Record<string, unknown>)[key])) errors.push(`morphology.rootSyllableCost.${k}.${key} 必須是非負的有限數`)
        } else if (!isCost(v)) errors.push(`morphology.rootSyllableCost.${k} 必須是非負的有限數，或 {entry, other}`)
      }
    }
  }
  if (s.maxSteps !== undefined && !(Number.isInteger(s.maxSteps) && s.maxSteps >= 0 && s.maxSteps <= MAX_STEPS_LIMIT)) {
    errors.push(`morphology.maxSteps 必須是 0–${MAX_STEPS_LIMIT} 的整數`)
  }
  if (s.vowels !== undefined && (typeof s.vowels !== 'string' || !s.vowels || hasSpace(s.vowels))) errors.push('morphology.vowels 必須是不含空白的非空字串')
  if (s.glides !== undefined) {
    const vowels: string = typeof s.vowels === 'string' ? s.vowels : DEFAULTS.vowels
    if (typeof s.glides !== 'string' || hasSpace(s.glides)) errors.push('morphology.glides 必須是不含空白的字串')
    else if (Array.from(s.glides as string).some((c) => !vowels.includes(c))) errors.push(`morphology.glides 必須是 vowels 的子集（${vowels}）`)
  }
  /** 用到 CGV、CVG 而沒有宣告滑音 */
  const needsGlides = (pattern: unknown, path: string) => {
    if (isGlidePattern(pattern) && !s.glides) errors.push(`${path} 用到 ${pattern}，要在 morphology.glides 宣告可以當滑音的元音（例如 "iu"）`)
  }

  for (const key of ['prefixes', 'suffixes', 'infixes']) {
    if (s[key] === undefined) continue
    if (!Array.isArray(s[key])) {
      errors.push(`morphology.${key} 必須是陣列`)
      continue
    }
    s[key].forEach((a: any, i: number) => {
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
      s.reduplication.forEach((r: any, i: number) => {
        const path = `morphology.reduplication[${i}]`
        if (!isReduplicationPattern(r?.pattern)) errors.push(`${path}.pattern 必須是 ${REDUPLICATION_PATTERNS.join('、')} 之一`)
        else needsGlides(r.pattern, path)
        if (r?.cost !== undefined && !isCost(r.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
        unknownKeys(r, ENTRY_KEYS.reduplication, path)
      })
  }
  if (s.circumfixes !== undefined) {
    if (!Array.isArray(s.circumfixes)) errors.push('morphology.circumfixes 必須是陣列')
    else
      s.circumfixes.forEach((c: any, i: number) => {
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
        if (c?.reduplication !== undefined) needsGlides(c.reduplication, path)
        if (c?.reduplication !== undefined && !isReduplicationPattern(c.reduplication)) {
          errors.push(`${path}.reduplication 必須是 ${REDUPLICATION_PATTERNS.join('、')} 之一`)
        }
        if (c?.cost !== undefined && !isCost(c.cost)) errors.push(`${path}.cost 必須是非負的有限數`)
        unknownKeys(c, ENTRY_KEYS.circumfix, path)
      })
  }
  if (s.alternations !== undefined) {
    if (!Array.isArray(s.alternations)) errors.push('morphology.alternations 必須是陣列')
    else
      s.alternations.forEach((a: any, i: number) => {
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
