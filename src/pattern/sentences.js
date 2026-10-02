/**
 * @file 句型搜尋的切詞：把一筆記錄的文字切成「句」與「詞格」，保留每個詞在原文中的位置（介面依位置高亮）。
 *
 * - **切詞**與搜尋索引相同：以空白與標點（babizu/search 的 TOKEN_SEPARATORS）分開，每個詞取搜尋鍵
 *   （searchKey：正規化並刪除體例符號，`talubik-ay` → talubikay）。
 * - **分句**：詞後面的標點含句末標點（`. ? !` 與全形的 。？！）時，下一個詞另起一句。相鄰與 `^` `$` 都以句為單位，
 *   `_*` 不會跨到下一句。
 * - **語法書的體例**（林鴻瑞《噶哈巫語參考語法》的例句）：
 *   - `(ka)`：可以省略的詞 → 這一格可有可無；
 *   - `iu/maki`：同一個位置的兩種說法 → 這一格擇一；
 *   - `*maki`（在 / 的選項中）：不合語法的說法 → 不參與比對；`*(ki)`：不能省略 → 照常；
 *   - `ma(a)sikakialah`：詞中括號裡的字母可有可無 → 這一格有兩種寫法。
 *   一筆記錄的每一種組合是一種「讀法」，任一種讀法符合就算（組合最多 MAX_READINGS 種，超過時只用
 *   第一種：可省略的都保留、擇一取第一個）。
 */

import { TOKEN_SEPARATORS } from '../search/text.js'

/** 一筆記錄（的一句）最多展開幾種讀法 */
export const MAX_READINGS = 16

/** 句末標點：後面的詞另起一句 */
const SENTENCE_END = /[.?!。？！]/u
/** 語法書的體例符號：另外解析，不當分隔符號 */
const MARKUP = new Set(['(', ')', '/', '*'])

/**
 * @typedef {object} PatternToken 一種讀法中的一個詞
 * @property {string} key 搜尋鍵
 * @property {number} start 在原文中的位置（UTF-16，[start, end)）
 * @property {number} end
 */

/**
 * @typedef {object} TokenCell 一個詞的位置：一或多種寫法，可能可以省略
 * @property {PatternToken[]} alts
 * @property {boolean} optional
 */

/**
 * @typedef {object} SegmentedText
 * @property {PatternToken[][][]} segments 每一句的各種讀法（每種讀法是一串詞）
 * @property {Set<string>} keys 出現過的所有搜尋鍵（候選篩選用）
 */

/** @param {string} ch */
const isSeparator = (ch) => !MARKUP.has(ch) && TOKEN_SEPARATORS.test(ch)

/**
 * @param {string} text 記錄的原文
 * @param {(text: string) => string} searchKey 語言設定檔的搜尋鍵
 * @returns {SegmentedText}
 */
export function segmentText(text, searchKey) {
  /** @type {TokenCell[][]} */
  const cellSegments = [[]]
  /** @type {Set<string>} */
  const keys = new Set()
  for (const chunk of text.matchAll(/\S+/gu)) {
    const base = /** @type {number} */ (chunk.index)
    // 依分隔字元切成幾段；分隔字元中有句末標點時，那一段之後另起一句
    let piece = ''
    let pieceStart = -1
    let offset = base
    /** @param {boolean} breakAfter */
    const flush = (breakAfter) => {
      if (piece) {
        const cell = parseCell(piece, pieceStart, searchKey)
        if (cell) {
          cellSegments[cellSegments.length - 1].push(cell)
          for (const a of cell.alts) keys.add(a.key)
        }
      }
      piece = ''
      pieceStart = -1
      if (breakAfter && cellSegments[cellSegments.length - 1].length > 0) cellSegments.push([])
    }
    for (const ch of chunk[0]) {
      if (isSeparator(ch)) flush(SENTENCE_END.test(ch))
      else {
        if (pieceStart === -1) pieceStart = offset
        piece += ch
      }
      offset += ch.length
    }
    flush(false)
  }
  return { segments: cellSegments.filter((s) => s.length > 0).map(readingsOf), keys }
}

/**
 * 一個詞（可能含體例符號）→ 詞格。沒有任何字母時為 null。
 * @param {string} raw
 * @param {number} start 在原文中的位置
 * @param {(text: string) => string} searchKey
 * @returns {TokenCell | null}
 */
function parseCell(raw, start, searchKey) {
  // 整個詞在括號中：可以省略；*(x)：不能省略（照常）
  let text = raw
  let at = start
  let optional = false
  if (text.startsWith('*(') && text.endsWith(')')) {
    text = text.slice(2, -1)
    at += 2
  } else if (text.startsWith('(') && text.endsWith(')') && !text.slice(1, -1).includes('(')) {
    text = text.slice(1, -1)
    at += 1
    optional = true
  }
  /** @type {PatternToken[]} */
  const alts = []
  const options = text.split('/')
  let pos = at
  for (const option of options) {
    const s = pos
    pos += option.length + 1
    // / 的選項中以 * 開頭的是不合語法的說法；沒有 / 時的 * 只是體例符號
    if (options.length > 1 && option.startsWith('*')) continue
    for (const variant of expandParens(option.replace(/\*/gu, ''))) {
      const key = searchKey(variant)
      if (key && !alts.some((a) => a.key === key)) alts.push({ key, start: s, end: s + option.length })
    }
  }
  return alts.length > 0 ? { alts, optional } : null
}

/**
 * 詞中的括號：裡面的字母可有可無（ma(a)sik → masik、maasik）。最多展開 3 組括號。
 * @param {string} text
 * @returns {string[]}
 */
function expandParens(text) {
  const m = /\(([^()]*)\)/u.exec(text)
  if (!m || (text.match(/\(/gu) ?? []).length > 3) return [text.replace(/[()]/gu, '')]
  const before = text.slice(0, m.index)
  const after = text.slice(m.index + m[0].length)
  // 先列「有括號中的字母」的寫法，再列沒有的
  return [...expandParens(before + m[1] + after), ...expandParens(before + after)]
}

/**
 * 一句的各種讀法：每一格選一種寫法（可以省略的也可以不選）。超過 MAX_READINGS 種時只用第一種。
 * @param {TokenCell[]} cells
 * @returns {PatternToken[][]}
 */
function readingsOf(cells) {
  let count = 1
  for (const c of cells) count *= c.alts.length + (c.optional ? 1 : 0)
  if (count > MAX_READINGS) return [cells.map((c) => c.alts[0])]
  /** @type {PatternToken[][]} */
  let out = [[]]
  for (const c of cells) {
    /** @type {PatternToken[][]} */
    const next = []
    for (const r of out) {
      for (const a of c.alts) next.push([...r, a])
      if (c.optional) next.push(r)
    }
    out = next
  }
  return out
}
