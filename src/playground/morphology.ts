/**
 * @file 展示版構詞分頁的模型：以構詞文法（詞素與組合規則；docs/language-profile.md、packages/bcdp/docs/morph-grammar.md）
 * 編輯，與 pazeh-kaxabu 等正式站台的設定檔同一種寫法，也就是同一個編譯與搜尋程式。
 *
 * 為什麼是文法：平面清單（前綴、後綴、中綴各一張表）寫不出組合——例如 p<a>u-…-ay 的 <a> 落在前綴 pu 裡面，
 * 單獨列出 pu-、<a>、-ay 並不會讓搜尋拆得出 pausunguday。文法的組合規則（詞素依推導順序排列）才描述得了，
 * 載入時由 `expandGrammar` 展開成引擎看得懂的平面清單，說明裡也顯示由哪些詞素構成。
 *
 * 舊的專案是平面清單：`flatToGrammar` 轉成等價的文法（每個詞綴是一個自由詞素，環綴是組合規則），
 * 轉不了的（手寫的 stemInitial 環綴等）回報原因，由「進階」分頁編輯。
 *
 * 不碰檔案、不碰畫面，瀏覽器與 Node 都能用，附單元測試。
 */

import type { ConstructionSpec, GrammarSpec, MorphemeSpec, MorphologySpec, ReduplicationPattern } from '#bcdp'

export type MorphemeType = MorphemeSpec['type']

/** 平面清單的五張表（轉成文法時不抄） */
const FLAT_LISTS = new Set(['prefixes', 'suffixes', 'infixes', 'reduplication', 'circumfixes'])

/** 文法的規格（有 morphemes 或 constructions） */
export function isGrammar(spec: unknown): spec is GrammarSpec {
  return !!spec && typeof spec === 'object' && ('morphemes' in spec || 'constructions' in spec)
}

export type Conversion = { ok: true; grammar: GrammarSpec } | { ok: false; reason: string }

const DEFAULT_VOWELS = 'aeiouéə'

/** 產生沒用過的 id（`prefix.mu`、`prefix.mu-2`…） */
function uniqueId(used: Set<string>, base: string): string {
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`
  used.add(id)
  return id
}

/** 詞素的形式（文法的 form 或 forms；重疊是型式） */
export function formsOf(m: Pick<MorphemeSpec, 'type' | 'form' | 'forms' | 'pattern'>): string[] {
  if (m.type === 'reduplication') return m.pattern ? [m.pattern] : []
  return m.forms ?? (m.form === undefined ? [] : [m.form])
}

/** 詞素寫成一般的標記：mu-、-ay、<a>、CV~（同位詞素以 / 分開） */
export function morphemeLabel(m: Pick<MorphemeSpec, 'type' | 'form' | 'forms' | 'pattern'>): string {
  const forms = formsOf(m).join('/') || '…'
  if (m.type === 'prefix') return `${forms}-`
  if (m.type === 'suffix') return `-${forms}`
  if (m.type === 'infix') return `<${forms}>`
  return `${forms}~`
}

/**
 * 平面清單 → 等價的文法。
 * - 前綴、後綴、中綴、重疊的每一項：一個自由詞素（順序照平面清單：前綴、後綴、中綴、重疊）；
 * - 環綴：一條組合規則，詞素依推導順序排列（前綴、詞根上的中綴或重疊、後綴；重疊必須是第一個）。
 *   環綴兩側如果已經是自由的詞綴就引用它，否則新增只在組合規則裡出現的詞素（`free: false`）；
 * - 與平面清單共用的欄位（cost、minStem、alternations…）照抄。
 *
 * 搜尋結果相同，只有一處更接近真正的辭典：中綴落在詞根上、外側有前綴的環綴（m<a>-…-ay），
 * 文法會另外產生元音開頭詞根上的串接形式（morph-grammar.md 2.3），平面清單沒有。
 * 轉不了的回報原因：手寫的 `stemInitial`，或有元音的前綴 ＋ 中綴（文法會把中綴插進前綴裡，意思不同）。
 */
export function flatToGrammar(spec: MorphologySpec): Conversion {
  const vowels = new Set(Array.from(spec.vowels ?? DEFAULT_VOWELS))
  const morphemes: MorphemeSpec[] = []
  const used = new Set<string>()
  /** 自由詞素：類型＋形式 → id（組合規則引用） */
  const free = new Map<string, string>()
  const extra = (e: { ref?: unknown; note?: unknown }) => ({ ...(e.ref !== undefined ? { ref: e.ref } : {}), ...(e.note !== undefined ? { note: e.note } : {}) })

  for (const [type, list] of [
    ['prefix', spec.prefixes],
    ['suffix', spec.suffixes],
    ['infix', spec.infixes],
  ] as const) {
    for (const a of list ?? []) {
      const id = uniqueId(used, `${type}.${a.form}`)
      morphemes.push({ id, type, form: a.form, ...(a.gloss ? { gloss: a.gloss } : {}), ...(a.cost !== undefined ? { cost: a.cost } : {}), ...extra(a as object) } as MorphemeSpec)
      if (!free.has(`${type}\u0000${a.form}`)) free.set(`${type}\u0000${a.form}`, id)
    }
  }
  for (const r of spec.reduplication ?? []) {
    const id = uniqueId(used, `reduplication.${r.pattern}`)
    morphemes.push({ id, type: 'reduplication', pattern: r.pattern, ...(r.gloss ? { gloss: r.gloss } : {}), ...(r.cost !== undefined ? { cost: r.cost } : {}), ...extra(r as object) } as MorphemeSpec)
    if (!free.has(`reduplication\u0000${r.pattern}`)) free.set(`reduplication\u0000${r.pattern}`, id)
  }

  /** 組合規則裡用到的詞素：已有自由的就引用，沒有就新增只在組合規則裡出現的 */
  const member = (type: MorphemeType, form: string): string => {
    const key = `${type}\u0000${form}`
    const known = free.get(key)
    if (known) return known
    const id = uniqueId(used, `${type}.${form}`)
    morphemes.push(type === 'reduplication' ? { id, type, pattern: form as ReduplicationPattern, free: false } : { id, type, form, free: false })
    free.set(key, id)
    return id
  }

  const constructions: ConstructionSpec[] = []
  const usedConstruction = new Set<string>(morphemes.map((m) => m.id))
  for (const [k, c] of (spec.circumfixes ?? []).entries()) {
    if (c.stemInitial) return { ok: false, reason: `環綴第 ${k + 1} 個有 stemInitial（詞根必須元音開頭）。文法會替組合規則自動產生這一項，手寫的沒辦法轉成文法` }
    if (c.infix !== undefined && c.reduplication !== undefined) return { ok: false, reason: `環綴第 ${k + 1} 個同時有 infix 與 reduplication` }
    if (c.prefix && c.infix !== undefined && Array.from(c.prefix).some((ch) => vowels.has(ch))) {
      return { ok: false, reason: `環綴第 ${k + 1} 個是有元音的前綴「${c.prefix}」加中綴：文法會把中綴插進前綴裡（m<in>u-），與平面清單「中綴落在詞根上」的意思不同` }
    }
    const sequence = [
      ...(c.reduplication !== undefined ? [member('reduplication', c.reduplication)] : []),
      ...(c.prefix ? [member('prefix', c.prefix)] : []),
      ...(c.infix !== undefined ? [member('infix', c.infix)] : []),
      ...(c.suffix ? [member('suffix', c.suffix)] : []),
    ]
    if (sequence.length < 2) return { ok: false, reason: `環綴第 ${k + 1} 個少於兩個部分` }
    const label = [c.prefix && `${c.prefix}-`, c.infix !== undefined && `<${c.infix}>`, c.reduplication !== undefined && `${c.reduplication}~`, c.suffix && `-${c.suffix}`].filter(Boolean).join('')
    constructions.push({ id: uniqueId(usedConstruction, `construction.${label}`), sequence, ...(c.gloss ? { gloss: c.gloss } : {}), ...(c.cost !== undefined ? { cost: c.cost } : {}), ...extra(c as object) } as ConstructionSpec)
  }

  const shared = Object.fromEntries(Object.entries(spec).filter(([key]) => !FLAT_LISTS.has(key)))
  return { ok: true, grammar: { ...shared, morphemes, constructions } as GrammarSpec }
}

/** 編輯用的文法：已經是文法就原樣，平面清單轉成文法（轉不了時回報原因） */
export function grammarOf(spec: MorphologySpec | GrammarSpec | undefined | null): Conversion | null {
  if (!spec) return null
  return isGrammar(spec) ? { ok: true, grammar: spec } : flatToGrammar(spec)
}

/** 新的詞素：id 是沒用過的 `類型.序號` */
export function newMorpheme(grammar: GrammarSpec, type: MorphemeType): MorphemeSpec {
  const taken = new Set([...(grammar.morphemes ?? []).map((m) => m.id), ...(grammar.constructions ?? []).map((c) => c.id)])
  let n = 1
  while (taken.has(`${type}.${n}`)) n++
  const id = `${type}.${n}`
  return type === 'reduplication' ? { id, type, pattern: 'CV' } : { id, type, form: '' }
}

/** 新的組合規則：id 是沒用過的 `construction.序號` */
export function newConstruction(grammar: GrammarSpec, sequence: string[]): ConstructionSpec {
  const taken = new Set([...(grammar.morphemes ?? []).map((m) => m.id), ...(grammar.constructions ?? []).map((c) => c.id)])
  let n = 1
  while (taken.has(`construction.${n}`)) n++
  return { id: `construction.${n}`, sequence }
}

/** 哪幾條組合規則用到這個詞素 */
export function constructionsUsing(grammar: GrammarSpec, morphemeId: string): ConstructionSpec[] {
  return (grammar.constructions ?? []).filter((c) => c.sequence.includes(morphemeId))
}

/** 刪掉詞素；用到它的組合規則一併刪掉（組合規則至少要兩個詞素，拿掉一個就不成立）。回傳被刪的組合規則 */
export function removeMorpheme(grammar: GrammarSpec, morphemeId: string): ConstructionSpec[] {
  const removed = constructionsUsing(grammar, morphemeId)
  grammar.morphemes = (grammar.morphemes ?? []).filter((m) => m.id !== morphemeId)
  grammar.constructions = (grammar.constructions ?? []).filter((c) => !removed.includes(c))
  return removed
}

/**
 * 把輸入的文字改成詞素的形式：以逗號、頓號分開（同位詞素，例如 m, mu, mi, me）；一個時寫 form，多個寫 forms。
 * 重疊不用這個（它的型式是下拉選單）。
 */
export function setForms(m: MorphemeSpec, text: string): void {
  const filled = text
    .split(/[,，、]/u)
    .map((s) => s.trim())
    .filter(Boolean)
  delete m.form
  delete m.forms
  if (filled.length > 1) m.forms = filled
  else m.form = filled[0] ?? ''
}

/** 詞素目前的形式寫成輸入框的文字（以逗號分開） */
export function formsText(m: MorphemeSpec): string {
  return formsOf(m).join(', ')
}

/** 沒有說明就刪掉欄位（空字串不寫進設定檔）；說明是依語系的物件時只改指定語系，保留其他語系 */
export function setGloss(entry: { gloss?: MorphemeSpec['gloss'] }, value: string, locale: string): void {
  if (entry.gloss && typeof entry.gloss === 'object') {
    const next = { ...entry.gloss, [locale]: value }
    if (Object.values(next).every((v) => !v)) delete entry.gloss
    else entry.gloss = next
  } else if (value) entry.gloss = value
  else delete entry.gloss
}

/** 說明在某個語系的文字（字串的說明所有語系共用） */
export function glossOf(gloss: MorphemeSpec['gloss'], locale: string): string {
  if (!gloss) return ''
  return typeof gloss === 'string' ? gloss : (gloss[locale] ?? '')
}
