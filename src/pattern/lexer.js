/**
 * @file 句型查詢的詞法分析：把查詢字串切成「詞塊」與運算符號。
 *
 * - 運算符號：`( ) | & ^ $ ! ? * + /` 與量詞 `{n}`、`{n,}`、`{n,m}`。
 * - 詞塊：連續、不含空白與運算符號的一段，例如 `kita`、`pa-…`、`m<in>u-…`、`@kita`、`_`。
 *   引號（`"…"` 或 `“…”`）中的文字原樣保留（可以含空白與運算符號），並且與緊鄰的文字合成同一個詞塊：
 *   `"mu"-…` 是一個詞塊，由引號片段 `mu` 與一般片段 `-…` 組成。引號中可以用 `\` 跳脫下一個字元。
 * - 每個記號記下前面有沒有空白（spaced）：量詞必須緊接在詞後面（`_*`，不是 `_ *`），剖析時要用到。
 *
 * 位置一律是 JavaScript 字串索引（UTF-16），錯誤訊息用它標出查詢中的範圍。
 */

import { PatternError } from './errors.js'

/** 單一字元的運算符號 */
const OPERATORS = new Set(['(', ')', '|', '&', '^', '$', '!', '?', '*', '+', '/'])
/** 開引號 → 可以接受的關引號 */
const QUOTES = new Map([
  ['"', new Set(['"', '”'])],
  ['“', new Set(['”', '"'])],
])

/**
 * @typedef {object} Piece 詞塊中的一段
 * @property {string} text
 * @property {boolean} quoted 是不是引號中的文字
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {{type: 'chunk', pieces: Piece[], start: number, end: number, spaced: boolean}
 *   | {type: '(' | ')' | '|' | '&' | '^' | '$' | '!' | '?' | '*' | '+' | '/', start: number, end: number, spaced: boolean}
 *   | {type: 'quant', min: number, max: number, start: number, end: number, spaced: boolean}} Token
 *   quant 的 max 為 Infinity 表示沒有上限（`{n,}`）
 */

/**
 * @param {string} q
 * @returns {Token[]}
 * @throws {PatternError}
 */
export function lex(q) {
  /** @type {Token[]} */
  const tokens = []
  let i = 0
  let spaced = true
  /** @type {Extract<Token, {type: 'chunk'}> | null} 正在累積的詞塊 */
  let chunk = null
  const endChunk = () => {
    if (chunk) tokens.push(chunk)
    chunk = null
  }
  /** @param {Piece} piece */
  const addPiece = (piece) => {
    if (!chunk) {
      chunk = { type: 'chunk', pieces: [], start: piece.start, end: piece.end, spaced }
      spaced = false
    }
    const last = chunk.pieces.at(-1)
    // 相鄰的一般文字併成一段（逐字加入時）
    if (last && !last.quoted && !piece.quoted && last.end === piece.start) {
      last.text += piece.text
      last.end = piece.end
    } else chunk.pieces.push(piece)
    chunk.end = piece.end
  }

  while (i < q.length) {
    const ch = q[i]
    if (/\s/u.test(ch)) {
      endChunk()
      spaced = true
      i++
      continue
    }
    const closers = QUOTES.get(ch)
    if (closers) {
      // 引號：讀到關引號為止，\ 跳脫下一個字元
      const start = i
      let text = ''
      i++
      let closed = false
      while (i < q.length) {
        if (q[i] === '\\' && i + 1 < q.length) {
          text += q[i + 1]
          i += 2
        } else if (closers.has(q[i])) {
          closed = true
          i++
          break
        } else text += q[i++]
      }
      if (!closed) throw new PatternError('E_UNCLOSED_QUOTE', start, q.length)
      addPiece({ text, quoted: true, start, end: i })
      continue
    }
    if (ch === '{') {
      endChunk()
      const m = /^\{\s*(\d+)\s*(?:(,)\s*(\d*)\s*)?\}/u.exec(q.slice(i))
      if (!m) {
        const close = q.indexOf('}', i)
        throw new PatternError('E_BAD_QUANT', i, close === -1 ? i + 1 : close + 1)
      }
      const min = Number(m[1])
      const max = m[2] ? (m[3] ? Number(m[3]) : Infinity) : min
      tokens.push({ type: 'quant', min, max, start: i, end: i + m[0].length, spaced })
      spaced = false
      i += m[0].length
      continue
    }
    if (ch === '}' || ch === '”') throw new PatternError('E_UNEXPECTED', i, i + 1, { found: ch })
    if (OPERATORS.has(ch)) {
      endChunk()
      tokens.push({ type: /** @type {any} */ (ch), start: i, end: i + 1, spaced })
      spaced = false
      i++
      continue
    }
    // 一般字元：以 code point 為單位加入詞塊（避免把代理對拆開）
    const cp = /** @type {number} */ (q.codePointAt(i))
    const s = String.fromCodePoint(cp)
    addPiece({ text: s, quoted: false, start: i, end: i + s.length })
    i += s.length
  }
  endChunk()
  return tokens
}
