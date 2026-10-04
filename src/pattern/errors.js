/**
 * @file 句型查詢的錯誤與提示。
 *
 * 引擎在 Web Worker 中執行，不能呼叫介面的翻譯函式 t()，所以這裡只定義**代碼、位置與參數**；
 * 顯示給讀者的文字由介面依代碼翻譯（app/src/lib/pattern.js）。代碼的意思寫在下面的清單，
 * 規格見 docs/pattern-query.md 第 6 節。
 */

/**
 * 錯誤（查詢無法執行）：
 * - E_TOO_LONG：查詢超過 MAX_QUERY_LENGTH 個字元
 * - E_TOO_MANY：詞的條件超過 MAX_ATOMS 個
 * - E_UNEXPECTED：這裡不能出現這個符號（params.found）
 * - E_UNCLOSED_PAREN、E_UNCLOSED_QUOTE、E_UNCLOSED_INFIX：括號、引號、中綴的 < > 沒有結束
 * - E_EXPECTED_ITEM：這裡應該有一個詞（例如 `(`、`|`、`&`、`!`、`/` 後面是空的）
 * - E_QUANT_POS：量詞前面沒有詞，或和前面的詞隔了空白（量詞要緊接在詞後面）
 * - E_QUANT_RANGE：量詞的次數不合理（{0}、{3,1}、超過 MAX_REPEAT）
 * - E_BAD_QUANT：{ } 裡不是次數
 * - E_EMPTY_MATCH：整個條件可以什麼詞都不比對到（例如只有 `_*`）；`pa*` 時 params.word 是 pa（介面建議寫 `pa…`）
 * - E_EMPTY_REPEAT：加了量詞的部分可以什麼詞都不比對到（例如 `(_?)*`）
 * - E_NEG_WIDTH：! 後面必須正好是一個詞（`!ki`、`!(ki|ni)`）
 * - E_UNDERSCORE：_ 要單獨寫，不能夾在詞裡
 * - E_EMPTY_WORD：只有標點、… 或體例符號，沒有字母（任一個詞請用 _）
 * - E_FAMILY_FORM：@ 後面要接一個完整的詞（不能有 … 或構詞符號）
 * - E_QUOTE_POS：構詞樣式中的引號要包住整個詞綴（`"mu"-…`）
 * - E_EMPTY_SEGMENT：構詞樣式中有空的一段（`pa--…`）
 * - E_WILDCARD_ATTACHED：構詞樣式中 … 與字母連在同一段（`m<in>…`），要用 - 分開（`m<in>-…`）
 * - E_MULTI_ROOT：構詞樣式中有兩個以上的詞根段，或兩個 … 相鄰（params.segments）
 * - E_AMBIGUOUS_ROOT：看不出哪一段是詞根，請用 … 或寫出詞根（params.segments）
 * - E_AMBIGUOUS_SIDE：`…-i-…` 中間的詞綴可以是前綴也可以是後綴，看不出哪一個 … 是詞根
 *   （params.forms；params.prefix、params.suffix 是只看最外層的兩種寫法）
 * - E_UNKNOWN_AFFIX：不是構詞規格中的詞綴（params.form、params.side、params.suggestions）
 * - E_NO_MORPHOLOGY：語言設定檔沒有構詞規格，不能用構詞樣式或 @
 */
export const PATTERN_ERRORS = /** @type {const} */ ([
  'E_TOO_LONG',
  'E_TOO_MANY',
  'E_UNEXPECTED',
  'E_UNCLOSED_PAREN',
  'E_UNCLOSED_QUOTE',
  'E_UNCLOSED_INFIX',
  'E_EXPECTED_ITEM',
  'E_QUANT_POS',
  'E_QUANT_RANGE',
  'E_BAD_QUANT',
  'E_EMPTY_MATCH',
  'E_EMPTY_REPEAT',
  'E_NEG_WIDTH',
  'E_UNDERSCORE',
  'E_EMPTY_WORD',
  'E_FAMILY_FORM',
  'E_QUOTE_POS',
  'E_EMPTY_SEGMENT',
  'E_WILDCARD_ATTACHED',
  'E_MULTI_ROOT',
  'E_AMBIGUOUS_ROOT',
  'E_AMBIGUOUS_SIDE',
  'E_UNKNOWN_AFFIX',
  'E_NO_MORPHOLOGY',
])

/**
 * 提示（查詢照樣執行，但讀者可能想的不是這個意思）：
 * - W_PUNCT：詞裡的標點（, . ; :）被忽略
 * - W_STAR_WORD：`pa*` 是「pa 重複零次以上」；要找開頭是 pa 的詞請寫 `pa…`
 * - W_TRAILING_Q：最後的 ? 表示「可有可無」，不是問號
 * - W_AFFIX_VARIANT：這個詞綴寫法不在規格中，依方言規則視為另一個（params.form → params.to）
 * - W_ALSO_CONSTRUCTION：這個寫法也是某個組合的整體寫法（params.form、params.parts），只找了詞素本身
 * - W_EXACT_MORPHOLOGY：精確模式下，構詞樣式只取每個詞最好的拆法、不取次佳的（morph.js 的 PARSE_SELECTION），找到的可能比標準模式少
 * - W_INNER_AFFIX：列出的前綴或後綴只算最外層；改成不錨定（`…-x-…`）可以多找到 params.count 個詞形
 *   （params.form 是那些詞綴，params.query 是改寫後的整個查詢，介面做成可以點的連結）
 */
export const PATTERN_WARNINGS = /** @type {const} */ ([
  'W_PUNCT',
  'W_STAR_WORD',
  'W_TRAILING_Q',
  'W_AFFIX_VARIANT',
  'W_ALSO_CONSTRUCTION',
  'W_EXACT_MORPHOLOGY',
  'W_INNER_AFFIX',
])

/** @typedef {typeof PATTERN_ERRORS[number]} PatternErrorCode */
/** @typedef {typeof PATTERN_WARNINGS[number]} PatternWarningCode */

/**
 * @typedef {object} PatternIssue 錯誤或提示：代碼、在查詢中的位置（UTF-16 索引，[start, end)）與參數
 * @property {PatternErrorCode | PatternWarningCode} code
 * @property {number} start
 * @property {number} end
 * @property {Record<string, unknown>} [params]
 */

/** 查詢無法執行時丟出的錯誤（位置與代碼見 PatternIssue） */
export class PatternError extends Error {
  /**
   * @param {PatternErrorCode} code
   * @param {number} start
   * @param {number} end
   * @param {Record<string, unknown>} [params]
   */
  constructor(code, start, end, params = {}) {
    super(`${code} @ ${start}-${end}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''}`)
    this.name = 'PatternError'
    this.code = code
    this.start = start
    this.end = end
    this.params = params
  }

  /** @returns {PatternIssue} */
  toIssue() {
    return { code: this.code, start: this.start, end: this.end, params: this.params }
  }
}

/** 查詢最長幾個字元 */
export const MAX_QUERY_LENGTH = 256
/** 一個查詢最多幾個詞的條件（atom） */
export const MAX_ATOMS = 32
/** 量詞的次數上限（一句最多約 25 個詞，再多沒有意義） */
export const MAX_REPEAT = 30
