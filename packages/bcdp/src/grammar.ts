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
 * 而那正是把中綴交給 op、在 r 上決定位置的情形（test/grammar.test.ts 以隨機序列與詞根檢查）。
 *
 * **展開**：每條組合規則的每一種同位詞素選擇各一項（笛卡兒積），有明確的上限；自由的詞素一個形式一項。
 * 清單的順序是「自由詞素（依規格順序）在前，組合規則（依規格順序）在後」，rank 記下這個順序：
 * 成本與步驟數都相同的分析，說明選 rank 較前的（morph-search 的 finish）。也就是只有在所有同分的分析
 * 都用到組合規則時，才依組合規則的順序選——與平面清單上的行為相同。
 */

import {
  isGlidePattern,
  isReduplicationPattern,
  REDUPLICATION_PATTERNS,
  validateFlatMorphology,
  type AffixSpec,
  type CircumfixSpec,
  type Gloss,
  type MorphologySpec,
  type Part,
  type ReduplicationPattern,
  type ReduplicationSpec,
} from './morphology-spec.ts'

export type { Part } from './morphology-spec.ts'

/** 文法寫法的一個詞素 */
export interface MorphemeSpec {
  id: string
  type: Part['type']
  /** 形式（與 forms 恰好一個；重疊不寫） */
  form?: string
  /** 同位詞素的各個形式 */
  forms?: string[]
  /** 重疊的型式 */
  pattern?: ReduplicationPattern
  gloss?: Gloss
  cost?: number
  /** false：只出現在組合規則裡，不單獨當作詞綴（預設 true） */
  free?: boolean
}

/** 文法寫法的一條組合規則 */
export interface ConstructionSpec {
  id: string
  /** 詞素 id，依推導順序 */
  sequence: string[]
  gloss?: Gloss
  cost?: number
}

/** 與平面清單共用的欄位 */
type SharedSpec = Pick<MorphologySpec, 'cost' | 'minStem' | 'maxSteps' | 'lemmaSpread' | 'lemmaRulePenalty' | 'virtualRootLengthCost' | 'rootSyllableCost' | 'vowels' | 'glides' | 'alternations'>

/** 語言設定檔的 `morphology` 區段（文法寫法） */
export interface GrammarSpec extends SharedSpec {
  morphemes?: MorphemeSpec[]
  constructions?: ConstructionSpec[]
}

/** 構詞文法展開時加在每一項上的資訊（設定檔不寫） */
export interface Expansion {
  /** 說明的順序（自由詞素在前、組合規則在後） */
  rank?: number
  /** 由哪些詞素構成（推導順序） */
  parts?: Part[]
}

/** 展開後的平面規格：每一項可以帶 Expansion */
export interface ExpandedSpec extends SharedSpec {
  prefixes?: Array<AffixSpec & Expansion>
  suffixes?: Array<AffixSpec & Expansion>
  infixes?: Array<AffixSpec & Expansion>
  reduplication?: Array<ReduplicationSpec & Expansion>
  circumfixes?: Array<CircumfixSpec & Expansion>
}

/** expandGrammar 的結果：五種清單都有（可能是空陣列） */
export type ExpandedGrammar = Required<Pick<ExpandedSpec, 'prefixes' | 'suffixes' | 'infixes' | 'reduplication' | 'circumfixes'>> & ExpandedSpec

/** 符號推導的結果：L · op(X) · R */
export interface Derivation {
  L: string
  op: { type: 'infix' | 'reduplication'; form: string } | null
  R: string
  error?: string
}

/** 展開後的項目總數上限：超過是規格錯誤（通常是同位詞素很多的詞素出現在很多組合規則裡） */
export const MAX_EXPANDED = 5000

const TYPES = new Set(['prefix', 'suffix', 'infix', 'reduplication'])
/** 文法寫法的頂層欄位；與平面清單共用的欄位（cost、alternations…）由 validateFlatMorphology 檢查 */
const GRAMMAR_KEYS = new Set(['morphemes', 'constructions'])
const SHARED_KEYS = new Set<keyof SharedSpec>(['cost', 'minStem', 'maxSteps', 'lemmaSpread', 'lemmaRulePenalty', 'virtualRootLengthCost', 'rootSyllableCost', 'vowels', 'glides', 'alternations'])
const MORPHEME_KEYS = new Set(['id', 'type', 'form', 'forms', 'pattern', 'gloss', 'cost', 'free', 'ref', 'note'])
const CONSTRUCTION_KEYS = new Set(['id', 'sequence', 'gloss', 'cost', 'ref', 'note'])
const hasSpace = (s: string) => /\s/u.test(s)
const isShared = (key: string): key is keyof SharedSpec => SHARED_KEYS.has(key as keyof SharedSpec)

/** 規格是否用文法寫法（有 morphemes 或 constructions）。 */
export function isGrammarSpec(spec: unknown): spec is GrammarSpec {
  return !!spec && typeof spec === 'object' && ('morphemes' in spec || 'constructions' in spec)
}

/**
 * 檢查文法寫法的規格，回傳錯誤訊息清單。與平面清單共用的欄位交給 validateFlatMorphology。
 * @param spec 內容還沒檢查過，所以各欄位以 any 讀取
 */
export function validateGrammar(spec: Record<string, any>): string[] {
  const errors: string[] = []
  for (const key of Object.keys(spec)) {
    if (!GRAMMAR_KEYS.has(key) && !isShared(key)) {
      errors.push(
        ['prefixes', 'suffixes', 'infixes', 'reduplication', 'circumfixes'].includes(key)
          ? `morphology.${key}：不能同時使用文法寫法（morphemes、constructions）與平面清單寫法`
          : `morphology.${key} 是未知的欄位`,
      )
    }
  }
  errors.push(...validateFlatMorphology(Object.fromEntries(Object.entries(spec).filter(([key]) => isShared(key)))))

  const morphemes = Array.isArray(spec.morphemes) ? spec.morphemes : []
  if (spec.morphemes !== undefined && !Array.isArray(spec.morphemes)) errors.push('morphology.morphemes 必須是陣列')
  const byId = new Map<string, any>()
  morphemes.forEach((m: any, i: number) => {
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
      if (!isReduplicationPattern(m.pattern)) errors.push(`${path}.pattern 必須是 ${REDUPLICATION_PATTERNS.join('、')} 之一`)
      else if (isGlidePattern(m.pattern) && !spec.glides) errors.push(`${path} 用到 ${m.pattern}，要在 morphology.glides 宣告可以當滑音的元音（例如 "iu"）`)
      if (m.form !== undefined || m.forms !== undefined) errors.push(`${path}：重疊寫 pattern，不寫 form`)
    } else {
      if (m.pattern !== undefined) errors.push(`${path}.pattern 只用於重疊`)
      if ((m.form === undefined) === (m.forms === undefined)) errors.push(`${path} 需要 form 或 forms（恰好一個）`)
      const forms: unknown[] = m.forms ?? (m.form === undefined ? [] : [m.form])
      if (m.forms !== undefined && (!Array.isArray(m.forms) || m.forms.length === 0)) errors.push(`${path}.forms 必須是非空陣列`)
      else {
        forms.forEach((f, k) => {
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
  const constructionIds = new Set<string>()
  constructions.forEach((c: any, i: number) => {
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
    const missing = c.sequence.filter((id: unknown) => typeof id !== 'string' || !byId.has(id))
    if (missing.length) errors.push(`${path}.sequence 有不存在的詞素：${missing.join('、')}`)
  })
  if (errors.length) return errors

  // 走到這裡，詞素與組合規則的形狀都已檢查過
  const grammar = spec as GrammarSpec
  const size = expandedSize(grammar)
  if (size > MAX_EXPANDED) return [`構詞文法展開後有 ${size} 項，超過上限 ${MAX_EXPANDED}：請減少同位詞素很多的詞素出現在組合規則裡的次數`]
  // 形狀：每一種同位詞素的選擇都做一次符號推導（不同的選擇，中綴可能落在前綴或詞根上），錯誤指出是哪一步
  const vowels = vowelSet(grammar)
  constructions.forEach((c: ConstructionSpec, i: number) => {
    const members = c.sequence.map((id) => byId.get(id) as MorphemeSpec)
    for (const parts of choices(members)) {
      const r = evaluate(parts, vowels)
      if (!r.error) continue
      errors.push(`morphology.constructions[${i}]（${c.id}，${parts.map((p) => p.form).join(' ＋ ')}）：${r.error}`)
      break
    }
  })
  return errors
}

/** 組合規則的每一種同位詞素選擇（依序列舉）。 */
function* choices(members: MorphemeSpec[]): Generator<Array<{ type: Part['type']; form: string }>> {
  if (members.length === 0) {
    yield []
    return
  }
  const [head, ...rest] = members
  const forms = head.type === 'reduplication' ? [head.pattern as string] : (head.forms ?? [head.form as string])
  for (const form of forms) for (const tail of choices(rest)) yield [{ type: head.type, form }, ...tail]
}

const vowelSet = (spec: GrammarSpec, normalize: (s: string) => string = (s) => s) => new Set(Array.from(normalize(spec.vowels ?? 'aeiouéə')))

/**
 * 符號推導（檔頭的編譯原理）：依推導順序套用詞素，詞根是符號 X。
 * @param steps 推導順序；重疊的 form 是型式
 */
export function evaluate(steps: ReadonlyArray<{ type: string; form: string }>, vowels: Set<string>): Derivation {
  let L = ''
  let R = ''
  let op: Derivation['op'] = null
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

/** 笛卡兒積的大小 */
function expandedSize(spec: GrammarSpec): number {
  const byId = new Map((spec.morphemes ?? []).map((m) => [m.id, m]))
  const count = (m: MorphemeSpec) => (m.type === 'reduplication' ? 1 : (m.forms?.length ?? 1))
  let size = 0
  for (const m of spec.morphemes ?? []) if (m.free !== false) size += count(m)
  for (const c of spec.constructions ?? []) size += c.sequence.reduce((n, id) => n * count(byId.get(id) as MorphemeSpec), 1)
  return size
}

/**
 * 把文法展開成平面規格（檔頭的編譯原理）。輸入必須已通過 validateGrammar。
 * @param normalize 詞綴的正規化（與搜尋鍵相同；插入中綴要看正規化後的元音）
 * @returns 每一項帶 parts 與 rank
 */
export function expandGrammar(spec: GrammarSpec, normalize: (s: string) => string = (s) => s): ExpandedGrammar {
  const vowels = vowelSet(spec, normalize)
  const cost = spec.cost ?? 0.3
  const out: ExpandedGrammar = {
    prefixes: [],
    suffixes: [],
    infixes: [],
    reduplication: [],
    circumfixes: [],
  }
  for (const key of SHARED_KEYS) if (spec[key] !== undefined) Object.assign(out, { [key]: spec[key] })
  let rank = 0
  const formsOf = (m: MorphemeSpec): string[] => (m.type === 'reduplication' ? [m.pattern as string] : (m.forms ?? [m.form as string]).map(normalize))
  const partOf = (m: MorphemeSpec, form: string): Part => ({ id: m.id, type: m.type, form, gloss: m.gloss ?? null })

  /** 一項：沒有 op、只有一側的是詞綴，其他的是環綴。 */
  const emit = (r: Derivation, info: { gloss: Gloss; cost: number; parts: Part[] }) => {
    const entry = { ...info, rank: rank++ }
    if (!r.op && !r.R) out.prefixes.push({ form: r.L, ...entry })
    else if (!r.op && !r.L) out.suffixes.push({ form: r.R, ...entry })
    else if (r.op && !r.L && !r.R) {
      if (r.op.type === 'infix') out.infixes.push({ form: r.op.form, ...entry })
      else out.reduplication.push({ pattern: r.op.form as ReduplicationPattern, ...entry })
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
  const byId = new Map((spec.morphemes ?? []).map((m) => [m.id, m]))
  // 組合規則在後（依規格順序），每一種同位詞素的選擇一項
  for (const c of spec.constructions ?? []) {
    const members = c.sequence.map((id) => byId.get(id) as MorphemeSpec)
    const walk = (k: number, parts: Part[]) => {
      if (k === members.length) {
        const r = evaluate(parts, vowels)
        emit(r, { gloss: c.gloss ?? null, cost: c.cost ?? cost, parts })
        return
      }
      for (const form of formsOf(members[k])) walk(k + 1, [...parts, partOf(members[k], form)])
    }
    walk(0, [])
  }
  return out
}
