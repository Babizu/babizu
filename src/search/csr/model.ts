/**
 * @file 對應組檢索（correspondence-set retrieval，CSR；實驗性）的模型檔格式。
 *
 * 模型是站台的資料（不是框架的程式）：由站台維護者從辭典資料學出各方言之間的語音對應（docs/csr.md），
 * 在站台設定 `csr.model` 指定；建置時複製成網站資料的 search/csr.json。
 * 檔案只存**計數**（每個對應組在對齊的同源詞中出現幾次、前後文單位的來源字串出現幾次），
 * 成本由框架在載入時依固定的公式算出（costs.ts）。語音對應全部來自資料：語言設定檔的方言規則（rules）不參與。
 */

export const CSR_MODEL_FORMAT = 'babizu-csr-model'
export const CSR_MODEL_VERSION = 1

/**
 * 一個對應組。
 * - 單一音段的：每個方言的反映形是一個音段或 `-`（缺口，也就是這個方言沒有對應的音段），sites 是它在對齊的同源詞中出現的欄數；
 * - 前後文單位：反映形是幾個音段連寫（{ pazeh: 'uh', kaxabu: 'oh' }：u 在 h 之前才對到 o），或有 position（只在詞首、詞尾成立）。
 *   sites 是它出現的次數；成本的分母是來源字串的出現次數（CsrModel.occurrences）。
 */
export interface CsrPattern {
  reflexes: Record<string, string>
  sites: number
  /** 只在詞首（initial）或詞尾（final）成立；剝了詞綴之後指的是詞幹的頭尾 */
  position?: 'initial' | 'final'
  /**
   * 前後文單位的分母（方言 → 次數），取代 occurrences 中這個字串的次數。
   * 學習時以元音類合併的家族（?ra → owa）用：每個成員的 sites 與分母都是整個家族的
   */
  of?: Record<string, number>
}

/** 演算法的參數（模型可以覆寫預設值） */
export interface CsrParams {
  /** 每剝一個詞綴的成本 λ */
  lambda: number
  /** 表中沒有的差異（打錯、沒見過的對應）：刪除或插入一個字元的成本 */
  typo: number
  /** 第一階段每個詞幹取幾個候選 */
  topM: number
  /** 學出的音類：任何一對方言中 P(w | s) 至少這麼大的兩個音段併成一類 */
  mergeProbability: number
  /** 「兩邊相同」的平滑 β */
  beta: number
  /** 對應組至少要有幾欄（前後文單位：幾次）才使用 */
  minSites: number
  /**
   * 分數換算成 BCDP 的刻度（搜尋引擎中與開頭相符、包含、辭典的構詞關係放在一起排序）：
   * 預設 0.2，打錯 4 → 0.8（BCDP 插入一個字元 0.8）、每剝一個詞綴 3 → 0.6（BCDP 的構詞命中約 0.5–0.7）
   */
  scoreScale: number
}

/** 寬鬆程度：回傳分數 ≤ a ＋ b × 查詢字元數的結果（與 BCDP 的模糊程度同一個形式，門檻隨詞長放寬） */
export interface CsrLevel {
  a: number
  b: number
}

export interface CsrModel {
  format: typeof CSR_MODEL_FORMAT
  version: typeof CSR_MODEL_VERSION
  /** 學習時的方言（站台 varieties 的代碼）；反映形以這些代碼為鍵 */
  dialects: string[]
  /** 音段清單（書寫層級；多字元的音段也列在這裡，切段時以最長匹配） */
  segments: string[]
  patterns: CsrPattern[]
  /**
   * 前後文單位的來源字串在對齊資料中出現幾次（方言 → 鍵 → 次數），當作成本的分母。
   * 鍵是字串本身，詞首的前面加 `^`、詞尾的後面加 `$`（`^'`、`l$`）；空字串是「可以插入的位置」數。
   * 前後文單位的每一邊都要有；只是短字串的計數，沒有詞形
   */
  occurrences?: Record<string, Record<string, number>>
  /** 沒有方言標記的記錄依來源推定方言（來源 id → 方言代碼）；沒列的來源當作方言未知 */
  sourceDialects?: Record<string, string>
  params?: Partial<CsrParams>
  levels?: { normal?: CsrLevel; loose?: CsrLevel }
  /** 學習的出處（資料、工具、日期），框架不讀 */
  provenance?: Record<string, unknown>
}

/** 預設參數：在巴宰–噶哈巫語的資料上選的（docs/csr.md） */
export const CSR_DEFAULTS: Readonly<CsrParams> = Object.freeze({ lambda: 3, typo: 4, topM: 300, mergeProbability: 0.7, beta: 1, minSites: 2, scoreScale: 0.2 })

/** 預設的寬鬆程度（同上；成本的刻度改了要重新校準，見 docs/csr.md） */
export const CSR_DEFAULT_LEVELS: Readonly<{ normal: CsrLevel; loose: CsrLevel }> = Object.freeze({ normal: { a: 4, b: 0.6 }, loose: { a: 5, b: 0.8 } })

/** occurrences 的鍵：詞首加 ^、詞尾加 $ */
export function occurrenceKey(form: string, position?: 'initial' | 'final'): string {
  return position === 'initial' ? `^${form}` : position === 'final' ? `${form}$` : form
}

/** 前後文單位：有位置，或某一邊是幾個字元、又不是單一音段（一個字元的一定是音段；缺口 - 不算） */
export function isContextPattern(p: CsrPattern, segments: ReadonlySet<string>): boolean {
  return p.position !== undefined || Object.values(p.reflexes).some((r) => r !== '-' && Array.from(r).length > 1 && !segments.has(r))
}

const isNonNegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
const PARAM_KEYS = Object.keys(CSR_DEFAULTS)
const MODEL_KEYS = new Set(['format', 'version', 'dialects', 'segments', 'patterns', 'occurrences', 'sourceDialects', 'params', 'levels', 'provenance'])

/**
 * 檢查模型檔，回傳錯誤訊息清單（空陣列表示正確）。
 * @param varieties 站台的變體代碼（給了就檢查模型的方言都在其中）
 */
export function validateCsrModel(model: unknown, varieties?: readonly string[]): string[] {
  const errors: string[] = []
  if (!model || typeof model !== 'object' || Array.isArray(model)) return ['模型必須是物件']
  const m = model as Record<string, any>
  for (const key of Object.keys(m)) if (!MODEL_KEYS.has(key)) errors.push(`${key} 是未知的欄位`)
  if (m.format !== CSR_MODEL_FORMAT) errors.push(`format 必須是 "${CSR_MODEL_FORMAT}"`)
  if (m.version !== CSR_MODEL_VERSION) errors.push(`version 必須是 ${CSR_MODEL_VERSION}`)
  const dialects: unknown = m.dialects
  if (!Array.isArray(dialects) || dialects.length < 2 || !dialects.every((d) => typeof d === 'string' && d)) errors.push('dialects 必須是至少兩個方言代碼的陣列')
  else {
    if (new Set(dialects).size !== dialects.length) errors.push('dialects 有重複的代碼')
    if (varieties) for (const d of dialects) if (!varieties.includes(d)) errors.push(`方言「${d}」不在站台的 varieties 中`)
  }
  if (!Array.isArray(m.segments) || !m.segments.every((s: unknown) => typeof s === 'string' && s.length > 0)) errors.push('segments 必須是非空字串的陣列')
  const occurrences: unknown = m.occurrences
  if (occurrences !== undefined) {
    if (!occurrences || typeof occurrences !== 'object' || Array.isArray(occurrences)) errors.push('occurrences 必須是「方言 → 鍵 → 次數」的物件')
    else
      for (const [d, counts] of Object.entries(occurrences)) {
        if (Array.isArray(dialects) && !dialects.includes(d)) errors.push(`occurrences 的方言「${d}」不在 dialects 中`)
        if (!counts || typeof counts !== 'object' || !Object.values(counts).every(isNonNegative)) errors.push(`occurrences.${d} 必須是「鍵 → 非負的數」的物件`)
      }
  }
  const segments = new Set<string>(Array.isArray(m.segments) ? m.segments : [])
  if (!Array.isArray(m.patterns)) errors.push('patterns 必須是陣列')
  else
    m.patterns.forEach((p: any, k: number) => {
      if (!p || typeof p !== 'object' || !isNonNegative(p.sites)) errors.push(`patterns[${k}].sites 必須是非負的數`)
      else if (!p.reflexes || typeof p.reflexes !== 'object' || !Object.values(p.reflexes).every((r) => typeof r === 'string' && r.length > 0)) errors.push(`patterns[${k}].reflexes 必須是「方言 → 反映形」的物件（缺口寫 -）`)
      else if (p.position !== undefined && p.position !== 'initial' && p.position !== 'final') errors.push(`patterns[${k}].position 只能是 initial 或 final`)
      else if (p.of !== undefined && (!p.of || typeof p.of !== 'object' || !Object.values(p.of).every(isNonNegative))) errors.push(`patterns[${k}].of 必須是「方言 → 非負的數」的物件`)
      else if (Array.isArray(dialects)) {
        for (const d of Object.keys(p.reflexes)) if (!dialects.includes(d)) errors.push(`patterns[${k}] 的方言「${d}」不在 dialects 中`)
        // 前後文單位的成本要用來源字串的出現次數
        if (isContextPattern(p, segments))
          for (const [d, r] of Object.entries(p.reflexes as Record<string, string>)) {
            const key = occurrenceKey(r === '-' ? '' : r, p.position)
            if (!isNonNegative(p.of?.[d]) && !isNonNegative((occurrences as Record<string, Record<string, unknown>> | undefined)?.[d]?.[key]))
              errors.push(`patterns[${k}] 是前後文單位，occurrences.${d} 要有「${key}」的出現次數（或在 of 中給分母）`)
          }
      }
    })
  if (m.sourceDialects !== undefined) {
    if (!m.sourceDialects || typeof m.sourceDialects !== 'object') errors.push('sourceDialects 必須是「來源 id → 方言代碼」的物件')
    else if (Array.isArray(dialects)) for (const [s, d] of Object.entries(m.sourceDialects)) if (!dialects.includes(d as string)) errors.push(`sourceDialects.${s}「${d}」不在 dialects 中`)
  }
  if (m.params !== undefined) {
    if (!m.params || typeof m.params !== 'object') errors.push('params 必須是物件')
    else
      for (const [k, v] of Object.entries(m.params)) {
        if (!PARAM_KEYS.includes(k)) errors.push(`params.${k} 是未知的參數`)
        else if (!isNonNegative(v)) errors.push(`params.${k} 必須是非負的有限數`)
      }
    if (m.params?.mergeProbability !== undefined && !(m.params.mergeProbability > 0 && m.params.mergeProbability <= 1)) errors.push('params.mergeProbability 必須在 (0, 1] 之間')
    if (m.params?.topM !== undefined && !(Number.isInteger(m.params.topM) && m.params.topM >= 1)) errors.push('params.topM 必須是正整數')
  }
  if (m.levels !== undefined) {
    if (!m.levels || typeof m.levels !== 'object') errors.push('levels 必須是物件')
    else
      for (const [k, v] of Object.entries(m.levels)) {
        if (k !== 'normal' && k !== 'loose') errors.push(`levels.${k} 是未知的等級（只有 normal、loose）`)
        else if (!v || typeof v !== 'object' || !isNonNegative((v as CsrLevel).a) || !isNonNegative((v as CsrLevel).b)) errors.push(`levels.${k} 必須是 { a, b }（非負的數）`)
      }
  }
  return errors
}
