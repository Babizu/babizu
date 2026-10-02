/**
 * @file 句型搜尋的介面工具：錯誤與提示代碼的說明文字、語詞索引的排序。
 *
 * 引擎（Web Worker）只回傳代碼與參數（babizu/pattern 的 errors.js），說明文字在這裡依介面語系翻譯。
 */

import { msg, t } from '@/i18n.js'

/** 錯誤代碼 → 說明（參數見 errors.js） */
const ERROR_TEXT = {
  E_TOO_LONG: msg('查詢太長（最多 {max} 個字元）。'),
  E_TOO_MANY: msg('詞的條件太多（最多 {max} 個）。'),
  E_UNEXPECTED: msg('這裡不能出現「{found}」。'),
  E_UNCLOSED_PAREN: msg('括號沒有結束，少了「)」。'),
  E_UNCLOSED_QUOTE: msg('引號沒有結束。'),
  E_UNCLOSED_INFIX: msg('中綴的「<」沒有對應的「>」。'),
  E_EXPECTED_ITEM: msg('這裡應該有一個詞。'),
  E_QUANT_POS: msg('量詞（? * + {n}）要緊接在詞的後面，例如 _*。'),
  E_QUANT_RANGE: msg('次數不合理：至少 1 次、最多 {max} 次，而且下限不能大於上限。'),
  E_BAD_QUANT: msg('{ } 裡要寫次數，例如 {2} 或 {1,3}。'),
  E_EMPTY_MATCH: msg('這個條件可以一個詞都不比對到，請至少寫一個一定要有的詞。'),
  E_EMPTY_REPEAT: msg('加了量詞的部分可以一個詞都不比對到。'),
  // 說明中的例子含 |（語系檔的語境分隔符號），以參數代入，見 EXAMPLES
  E_NEG_WIDTH: msg('! 後面必須正好是一個詞，例如 {a} 或 {b}。'),
  E_UNDERSCORE: msg('_ 代表任一個詞，要單獨寫，不能夾在詞裡。'),
  E_EMPTY_WORD: msg('這裡沒有字母；任一個詞請用 _。'),
  E_FAMILY_FORM: msg('@ 後面要接一個完整的詞，例如 @kita。'),
  E_QUOTE_POS: msg('構詞樣式中的引號要包住整個詞綴，例如 "mu"-…。'),
  E_EMPTY_SEGMENT: msg('構詞樣式中有空的一段。'),
  E_WILDCARD_ATTACHED: msg('「{text}」：… 和詞綴之間要用 - 分開，例如 m<in>-…。'),
  E_MULTI_ROOT: msg('構詞樣式只能有一個詞根。'),
  E_AMBIGUOUS_ROOT: msg('看不出哪一段是詞根，請用 … 標出詞根，或寫出詞根。'),
  E_UNKNOWN_AFFIX: msg('「{form}」不是構詞規格中的詞綴。'),
  E_NO_MORPHOLOGY: msg('這個辭典的語言設定檔沒有構詞規格，不能用構詞樣式（- < > ~）或 @。'),
}

/** 說明中固定的例子（含 | 的不能寫在譯文的鍵裡） */
const EXAMPLES = /** @type {Record<string, Record<string, string>>} */ ({ E_NEG_WIDTH: { a: '!ki', b: '!(ki|ni)' } })

/** 提示代碼 → 說明 */
const WARNING_TEXT = {
  W_PUNCT: msg('詞裡的標點已忽略。'),
  W_STAR_WORD: msg('「{text}*」表示 {text} 重複零次以上；要找開頭是 {text} 的詞請寫 {text}…'),
  W_TRAILING_Q: msg('最後的 ? 表示「可有可無」，不是問號。'),
  W_AFFIX_VARIANT: msg('「{form}」不在構詞規格中，依方言規則視為「{to}」。'),
  W_ALSO_CONSTRUCTION: msg('「{form}」也是 {parts} 的寫法，這裡只找 {form}；兩者都要找請用擇一的寫法。'),
  W_EXACT_MORPHOLOGY: msg('精確模式下，構詞分析的成本上限較低，找到的可能比標準模式少。'),
}

/**
 * @typedef {{code: string, start: number, end: number, params?: Record<string, any>}} PatternIssue
 */

/**
 * 錯誤或提示的說明，以及（有的話）建議。
 * @param {PatternIssue} issue
 * @returns {{text: string, hint: string | null}}
 */
export function patternIssueText(issue) {
  const params = issue.params ?? {}
  if (issue.code === 'E_EMPTY_MATCH' && params.word) {
    return { text: t(WARNING_TEXT.W_STAR_WORD, { text: params.word }), hint: null }
  }
  const table = /** @type {Record<string, string>} */ (issue.code.startsWith('W_') ? WARNING_TEXT : ERROR_TEXT)
  const template = table[issue.code]
  const text = template ? t(template, { ...EXAMPLES[issue.code], ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }) : issue.code
  /** @type {string | null} */
  let hint = null
  if (issue.code === 'E_UNKNOWN_AFFIX') {
    const parts = []
    if (params.suggestions?.length) parts.push(t('最接近的：{list}', { list: params.suggestions.join(t('、')) }))
    // pa- 這種寫法也常是辭典的詞根寫法（kita-）
    if (params.side === 'prefix') {
      const root = String(params.form ?? '').replace(/-$/u, '')
      if (root.length > 2) parts.push(t('如果「{root}」是詞根，請直接寫 {root} 或 @{root}。', { root }))
    }
    hint = parts.join(' ') || null
  }
  return { text, hint }
}

/** 語詞索引的排序方式 */
export const KWIC_SORTS = [
  { key: 'position', label: msg('原本的順序') },
  { key: 'left', label: msg('左邊的詞') },
  { key: 'match', label: msg('命中的詞') },
  { key: 'right', label: msg('右邊的詞') },
]
