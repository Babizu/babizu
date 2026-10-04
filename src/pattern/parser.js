/**
 * @file 句型查詢的剖析：記號 → 語法樹（ast.js）。只看寫法，不需要語言知識；
 * 構詞樣式的詞綴、詞根由 morph.js 依語言設定檔解析。
 *
 * ## 文法（EBNF；運算的結合由緊到鬆：`/` → 前置 `!` → 量詞 → 相鄰 → `|` → `&`）
 *
 * ```
 * query   = cond { "&" [ "!" ] cond } ;     (* & 後面的 ! 表示這筆記錄不能含有後面的條件 *)
 * cond    = alt ;
 * alt     = seq { "|" seq } ;
 * seq     = item { item } ;
 * item    = unary [ quant ] ;               (* 量詞要緊接在前面，中間不能有空白 *)
 * unary   = "!" unary | primary ;           (* 序列中的 !：一個不符合後面條件的詞 *)
 * primary = "(" alt ")" | "^" | "$" | slot ;
 * slot    = chunk { "/" chunk } ;           (* ki/ni：同一格擇一 *)
 * quant   = "?" | "*" | "+" | "{" n "}" | "{" n "," "}" | "{" n "," m "}" ;
 * chunk   = 詞塊（lexer.js）：_、詞、"詞"、"幾個 詞"、含 … 的拼寫樣式、@詞、構詞樣式
 * ```
 *
 * 規則（違反時丟出 PatternError，代碼見 errors.js）：
 * - 第一個條件一定是正面的；它開頭的 `!` 是序列中的 `!`（`!ki _`：一個不是 ki 的詞，接著任一個詞）。
 * - 條件不能什麼詞都不比對（`_*`、`kita?` 單獨成一個條件）；加量詞的部分也不能（`(_?)*`）。
 * - 序列中的 `!` 後面必須正好是一個詞。
 */

import { atomsOf, widthOf } from './ast.js'
import { MAX_ATOMS, MAX_QUERY_LENGTH, MAX_REPEAT, PatternError } from './errors.js'
import { lex } from './lexer.js'

/** 詞中會被忽略的標點（斷詞時本來就是分隔符號；… 與 ... 另外處理） */
const PUNCTUATION = /[,.;:。，、；：]/gu
/** 構詞樣式的符號：詞綴分界（= 與 - 相同）、重疊、中綴 */
const MORPH_CHARS = /[-=~<>]/u

/**
 * @param {string} query
 * @returns {import('./ast.js').PatternQuery}
 * @throws {PatternError}
 */
export function parsePattern(query) {
  if (query.length > MAX_QUERY_LENGTH) throw new PatternError('E_TOO_LONG', MAX_QUERY_LENGTH, query.length, { max: MAX_QUERY_LENGTH })
  const tokens = lex(query)
  /** @type {import('./errors.js').PatternIssue[]} */
  const warnings = []
  let pos = 0
  const peek = () => tokens[pos]
  const end = query.length

  /** @returns {import('./ast.js').PatternCondition[]} */
  function parseQuery() {
    if (tokens.length === 0) throw new PatternError('E_EXPECTED_ITEM', 0, end)
    const conditions = [{ negated: false, body: parseAlt(), start: 0, end: 0 }]
    while (peek()?.type === '&') {
      const amp = tokens[pos++]
      let negated = false
      if (peek()?.type === '!') {
        negated = true
        pos++
      }
      if (!peek() || peek().type === '&') throw new PatternError('E_EXPECTED_ITEM', amp.start, amp.end)
      conditions.push({ negated, body: parseAlt(), start: amp.end, end: 0 })
    }
    const extra = peek()
    if (extra) throw new PatternError('E_UNEXPECTED', extra.start, extra.end, { found: query.slice(extra.start, extra.end) })
    for (const c of conditions) {
      c.start = c.body.start
      c.end = c.body.end
    }
    return conditions
  }

  /** @returns {import('./ast.js').PatternNode} */
  function parseAlt() {
    const options = [parseSeq()]
    while (peek()?.type === '|') {
      const bar = tokens[pos++]
      if (!startsItem(peek())) throw new PatternError('E_EXPECTED_ITEM', bar.start, bar.end)
      options.push(parseSeq())
    }
    return options.length === 1 ? options[0] : { type: 'alt', options, start: options[0].start, end: /** @type {any} */ (options.at(-1)).end }
  }

  /** @returns {import('./ast.js').PatternNode} */
  function parseSeq() {
    /** @type {import('./ast.js').PatternNode[]} */
    const items = []
    while (startsItem(peek())) items.push(parseItem())
    if (items.length === 0) {
      const t = peek()
      if (t) throw new PatternError(t.type === ')' || t.type === '|' || t.type === '&' ? 'E_EXPECTED_ITEM' : 'E_QUANT_POS', t.start, t.end)
      throw new PatternError('E_EXPECTED_ITEM', end, end)
    }
    return items.length === 1 ? items[0] : { type: 'seq', items, start: items[0].start, end: /** @type {any} */ (items.at(-1)).end }
  }

  /** @returns {import('./ast.js').PatternNode} */
  function parseItem() {
    const node = parseUnary()
    const t = peek()
    if (!t || !isQuant(t)) return node
    if (t.spaced) throw new PatternError('E_QUANT_POS', t.start, t.end)
    pos++
    if (node.type === 'anchor') throw new PatternError('E_QUANT_POS', t.start, t.end)
    const [min, max] = t.type === '?' ? [0, 1] : t.type === '*' ? [0, Infinity] : t.type === '+' ? [1, Infinity] : [/** @type {any} */ (t).min, /** @type {any} */ (t).max]
    if (max < 1 || min > max || min > MAX_REPEAT || (max !== Infinity && max > MAX_REPEAT)) {
      throw new PatternError('E_QUANT_RANGE', t.start, t.end, { max: MAX_REPEAT })
    }
    if (widthOf(node).min === 0) throw new PatternError('E_EMPTY_REPEAT', node.start, t.end)
    // pa* 是「pa 重複零次以上」；寫的人多半是要找開頭是 pa 的詞
    if (t.type === '*' && node.type === 'atom' && (node.atom.kind === 'word' || node.atom.kind === 'exact')) {
      warnings.push({ code: 'W_STAR_WORD', start: node.start, end: t.end, params: { text: node.atom.text } })
    }
    if (t.type === '?' && pos === tokens.length) warnings.push({ code: 'W_TRAILING_Q', start: t.start, end: t.end })
    return { type: 'repeat', node, min, max, start: node.start, end: t.end }
  }

  /** @returns {import('./ast.js').PatternNode} */
  function parseUnary() {
    const t = peek()
    if (t?.type !== '!') return parsePrimary()
    pos++
    if (!startsItem(peek())) throw new PatternError('E_EXPECTED_ITEM', t.start, t.end)
    const inner = parseUnary()
    const w = widthOf(inner)
    if (w.min !== 1 || w.max !== 1 || containsAnchor(inner)) throw new PatternError('E_NEG_WIDTH', t.start, inner.end)
    return { type: 'not', node: inner, start: t.start, end: inner.end }
  }

  /** @returns {import('./ast.js').PatternNode} */
  function parsePrimary() {
    const t = tokens[pos++]
    if (t.type === '(') {
      if (!startsItem(peek())) throw new PatternError(peek() ? 'E_EXPECTED_ITEM' : 'E_UNCLOSED_PAREN', t.start, t.end)
      const inner = parseAlt()
      const close = peek()
      if (close?.type !== ')') throw new PatternError('E_UNCLOSED_PAREN', t.start, close ? close.start : end)
      pos++
      return { ...inner, start: t.start, end: close.end }
    }
    if (t.type === '^') return { type: 'anchor', at: 'start', start: t.start, end: t.end }
    if (t.type === '$') return { type: 'anchor', at: 'end', start: t.start, end: t.end }
    if (t.type !== 'chunk') throw new PatternError('E_UNEXPECTED', t.start, t.end, { found: query.slice(t.start, t.end) })
    const options = [chunkNode(t, warnings)]
    while (peek()?.type === '/') {
      const slash = tokens[pos++]
      const next = peek()
      if (next?.type !== 'chunk') throw new PatternError('E_EXPECTED_ITEM', slash.start, slash.end)
      pos++
      options.push(chunkNode(next, warnings))
    }
    return options.length === 1 ? options[0] : { type: 'alt', options, start: options[0].start, end: /** @type {any} */ (options.at(-1)).end }
  }

  const conditions = parseQuery()
  for (const c of conditions) {
    // 條件不能什麼詞都不比對：否則每一筆記錄都「符合」，也標不出命中的位置
    if (widthOf(c.body).min === 0) {
      // pa* 多半是要找開頭是 pa 的詞：附上那個詞，介面建議寫 pa…
      const b = c.body
      const star = b.type === 'repeat' && b.max === Infinity && b.node.type === 'atom' && (b.node.atom.kind === 'word' || b.node.atom.kind === 'exact')
      throw new PatternError('E_EMPTY_MATCH', c.start, c.end, star ? { word: /** @type {any} */ (b.node).atom.text } : {})
    }
  }
  const atoms = conditions.flatMap((c) => [...atomsOf(c.body)])
  if (atoms.length > MAX_ATOMS) throw new PatternError('E_TOO_MANY', atoms[MAX_ATOMS].start, end, { max: MAX_ATOMS })
  return { conditions, warnings }
}

/** @param {import('./lexer.js').Token | undefined} t */
function startsItem(t) {
  return Boolean(t) && (t?.type === 'chunk' || t?.type === '(' || t?.type === '^' || t?.type === '$' || t?.type === '!')
}

/** @param {import('./lexer.js').Token} t */
function isQuant(t) {
  return t.type === '?' || t.type === '*' || t.type === '+' || t.type === 'quant'
}

/** @param {import('./ast.js').PatternNode} node @returns {boolean} */
function containsAnchor(node) {
  switch (node.type) {
    case 'anchor':
      return true
    case 'not':
    case 'repeat':
      return containsAnchor(node.node)
    case 'seq':
      return node.items.some(containsAnchor)
    case 'alt':
      return node.options.some(containsAnchor)
    default:
      return false
  }
}

/**
 * 一個詞塊轉成節點：通常是一個 atom；引號中有空白時是幾個「拼寫完全相同」的詞連在一起。
 * @param {Extract<import('./lexer.js').Token, {type: 'chunk'}>} chunk
 * @param {import('./errors.js').PatternIssue[]} warnings
 * @returns {import('./ast.js').PatternNode}
 */
function chunkNode(chunk, warnings) {
  const { pieces, start, end } = chunk
  /** @param {import('./ast.js').PatternAtom} atom @param {number} [s] @param {number} [e] @returns {import('./ast.js').PatternNode} */
  const atomNode = (atom, s = start, e = end) => ({ type: 'atom', atom, start: s, end: e })

  // 整個詞塊是引號：拼寫完全相同；有空白時是連續的幾個詞
  if (pieces.length === 1 && pieces[0].quoted) {
    const words = pieces[0].text.trim().split(/\s+/u).filter(Boolean)
    if (words.length === 0) throw new PatternError('E_EMPTY_WORD', start, end)
    if (words.length === 1) return atomNode({ kind: 'exact', text: words[0] })
    const items = words.map((w) => atomNode({ kind: 'exact', text: w }))
    return { type: 'seq', items, start, end }
  }

  // 一般文字：... 換成 …，標點忽略（提示）
  let stripped = false
  const norm = pieces.map((p) => {
    if (p.quoted) return p
    let text = p.text.replace(/\.\.\./gu, '…')
    const without = text.replace(PUNCTUATION, '')
    if (without !== text) stripped = true
    text = without
    return { ...p, text }
  })
  if (stripped) warnings.push({ code: 'W_PUNCT', start, end })
  const plain = norm.map((p) => p.text).join('')
  const text = plain

  if (norm.some((p) => !p.quoted && p.text.includes('_'))) {
    if (norm.length === 1 && plain === '_') return atomNode({ kind: 'any' })
    throw new PatternError('E_UNDERSCORE', start, end)
  }
  if (plain.startsWith('@') && !norm[0].quoted) {
    const word = plain.slice(1)
    if (!word) throw new PatternError('E_EXPECTED_ITEM', start, end)
    if (norm.length > 1 || word.includes('…') || MORPH_CHARS.test(word) || word.includes('@')) throw new PatternError('E_FAMILY_FORM', start, end)
    return atomNode({ kind: 'family', text: word })
  }
  if (norm.length > 1 || norm.some((p) => !p.quoted && MORPH_CHARS.test(p.text))) {
    return atomNode({ kind: 'morph', segments: morphSegments(norm, start, end), text })
  }
  if (!plain.replace(/…/gu, '')) throw new PatternError('E_EMPTY_WORD', start, end)
  if (plain.includes('…')) return atomNode({ kind: 'glob', parts: plain.split('…'), text })
  return atomNode({ kind: 'word', text })
}

/**
 * 構詞樣式的分段（只看寫法）：以 `-`、`=`（與 - 相同）、`~` 分段，抽出每一段的中綴 `<x>`。
 * - 宿主是 `…` 的一段是任意詞根；宿主不能同時有 … 和字母（`m<in>…` 要寫成 `m<in>-…`）。
 * - 頭尾的空段是省略的詞根：`pa-` ＝ `pa-…`、`-en` ＝ `…-en`；中間的空段（`pa--…`）是錯誤。
 * - `x~` 的一段是重疊部分（重疊由詞根決定，x 寫不寫都一樣）。
 * - 引號要包住整個宿主（`"mu"-…`），表示只要這個同位詞素寫法。
 * @param {Array<{text: string, quoted: boolean, start: number, end: number}>} pieces
 * @param {number} start
 * @param {number} end
 * @returns {import('./ast.js').MorphSegment[]}
 */
function morphSegments(pieces, start, end) {
  /** @type {import('./ast.js').MorphSegment[]} */
  const segments = []
  /** @type {{host: string, hostQuoted: boolean, mixedQuote: boolean, infixes: import('./ast.js').MorphSegment['infixes'], start: number, end: number}} */
  let cur = { host: '', hostQuoted: false, mixedQuote: false, infixes: [], start, end: start }
  /** @param {boolean} red @param {number} at */
  const close = (red, at) => {
    if (cur.mixedQuote || (cur.hostQuoted && cur.host.includes('…'))) throw new PatternError('E_QUOTE_POS', cur.start, at)
    const wildcard = cur.host === '…'
    if (cur.host.includes('…') && !wildcard) throw new PatternError('E_WILDCARD_ATTACHED', cur.start, at, { text: cur.host })
    segments.push({ host: wildcard ? '…' : cur.host, quoted: cur.hostQuoted, wildcard, infixes: cur.infixes, red, start: cur.start, end: at })
    cur = { host: '', hostQuoted: false, mixedQuote: false, infixes: [], start: at + 1, end: at + 1 }
  }
  for (const p of pieces) {
    if (p.quoted) {
      if (cur.host || cur.hostQuoted) cur.mixedQuote = true
      cur.host += p.text
      cur.hostQuoted = true
      continue
    }
    const chars = Array.from(p.text)
    let at = p.start
    for (let k = 0; k < chars.length; k++) {
      const ch = chars[k]
      if (ch === '-' || ch === '=' || ch === '~') {
        close(ch === '~', at)
      } else if (ch === '<') {
        const s = at
        let form = ''
        let j = k + 1
        let a = at + 1
        while (j < chars.length && chars[j] !== '>') {
          form += chars[j]
          a += chars[j].length
          j++
        }
        if (j >= chars.length) throw new PatternError('E_UNCLOSED_INFIX', s, end)
        if (!form) throw new PatternError('E_EMPTY_SEGMENT', s, a + 1)
        cur.infixes.push({ form, start: s, end: a + 1 })
        at = a + 1
        k = j
        continue
      } else if (ch === '>') {
        throw new PatternError('E_UNEXPECTED', at, at + 1, { found: '>' })
      } else {
        if (cur.hostQuoted) cur.mixedQuote = true
        cur.host += ch
      }
      at += ch.length
    }
  }
  close(false, end)
  // 頭尾沒有字母、沒有中綴的段是省略的詞根；中間的空段是錯誤
  segments.forEach((s, k) => {
    if (s.host || s.infixes.length || s.red) return
    if (k === 0 || k === segments.length - 1) {
      s.host = '…'
      s.wildcard = true
      // 標出省略的位置：分界符號本身
      s.start = k === 0 ? start : s.start - 1
      s.end = k === 0 ? start + 1 : end
    } else throw new PatternError('E_EMPTY_SEGMENT', s.start - 1, s.end + 1)
  })
  // … 是詞根段，或寫在最外側（第一段、最後一段）表示那一側不錨定（`…-pa-…`）；哪一個是詞根由 morph.js 依詞綴判斷。
  // 這裡只擋寫法上一定不對的：兩個 … 相鄰（`…-…`），或不在頭尾的 … 有兩個以上
  const core = segments.filter((s) => !s.red)
  const inner = core.filter((s, k) => s.wildcard && k !== 0 && k !== core.length - 1)
  const adjacent = core.some((s, k) => k > 0 && s.wildcard && core[k - 1].wildcard)
  if (inner.length > 1 || adjacent) {
    throw new PatternError('E_MULTI_ROOT', start, end, { segments: core.filter((s) => s.wildcard).map((s) => s.host) })
  }
  return segments
}
