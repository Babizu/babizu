/**
 * @file 句型查詢的語法樹（AST）與它的基本性質。
 *
 * 一個查詢由一或多個「條件」以 `&` 連接（同一筆記錄都要符合）；`&` 後面的條件可以加 `!`（不能含有）。
 * 每個條件是一個「序列運算式」，描述一段連續的詞：
 *
 * | 節點 | 寫法 | 比對 |
 * |---|---|---|
 * | atom | `kita`、`"kita"`、`pa…`、`pa-…`、`@kita`、`_` | 一個詞（詞的條件見 PatternAtom） |
 * | not | `!ki`、`!(ki\|ni)` | 一個「不符合裡面條件」的詞 |
 * | seq | `a b c` | 依序相鄰 |
 * | alt | `a \| b`、`ki/ni` | 擇一（依寫的順序優先） |
 * | repeat | `x?`、`x*`、`x+`、`x{n,m}` | 重複 min～max 次（貪婪：先試多的） |
 * | anchor | `^`、`$` | 句首、句尾（不佔詞） |
 */

/**
 * @typedef {object} MorphSegment 構詞樣式中以 `-`（或 `=`）、`~` 分開的一段（剖析時只看寫法，語言知識在 morph.js 解析）
 * @property {string} host 這一段除去中綴後的字母（宿主）；`…` 表示任意詞根；空字串表示只有中綴
 * @property {boolean} quoted 宿主寫在引號中（只要這個同位詞素寫法，不歸併）
 * @property {boolean} wildcard 宿主是 `…`（或省略的詞根，例如 `pa-` 的後面）
 * @property {Array<{form: string, start: number, end: number}>} infixes 這一段裡的中綴 `<x>`
 * @property {boolean} red 這一段是重疊部分（後面接 `~`）
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {{kind: 'any'}
 *   | {kind: 'word', text: string}
 *   | {kind: 'exact', text: string}
 *   | {kind: 'glob', parts: string[], text: string}
 *   | {kind: 'family', text: string}
 *   | {kind: 'morph', segments: MorphSegment[], text: string}} PatternAtom
 *   詞的條件：
 *   - any：任一個詞（`_`）
 *   - word：依模糊程度比對拼寫（`kita`）
 *   - exact：拼寫完全相同（`"kita"`）
 *   - glob：只看拼寫的開頭、結尾、包含（`pa…`；parts 是以 … 分開的各段，例如 ['pa', '']）
 *   - family：詞族（`@kita`）：本身、相近拼寫、確定派生、自動派生
 *   - morph：構詞樣式（`pa-…`、`m<in>u-…`、`pa-kita`）
 *   text 是寫法（還沒轉成搜尋鍵）
 */

/**
 * @typedef {{type: 'atom', atom: PatternAtom, start: number, end: number}
 *   | {type: 'not', node: PatternNode, start: number, end: number}
 *   | {type: 'seq', items: PatternNode[], start: number, end: number}
 *   | {type: 'alt', options: PatternNode[], start: number, end: number}
 *   | {type: 'repeat', node: PatternNode, min: number, max: number, start: number, end: number}
 *   | {type: 'anchor', at: 'start' | 'end', start: number, end: number}} PatternNode
 */

/**
 * @typedef {object} PatternCondition
 * @property {boolean} negated 這筆記錄不能含有這個條件（`& !…`）
 * @property {PatternNode} body
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} PatternQuery
 * @property {PatternCondition[]} conditions 第一個一定是正面的條件（主條件：語詞索引與頻率以它為準）
 * @property {import('./errors.js').PatternIssue[]} warnings 剖析時的提示
 */

/**
 * 節點最少、最多佔幾個詞（錨點不佔詞；沒有上限時 max 為 Infinity）。
 * 用來檢查「條件不能什麼都不比對」「! 後面正好一個詞」等規則。
 * @param {PatternNode} node
 * @returns {{min: number, max: number}}
 */
export function widthOf(node) {
  switch (node.type) {
    case 'atom':
    case 'not':
      return { min: 1, max: 1 }
    case 'anchor':
      return { min: 0, max: 0 }
    case 'seq': {
      let min = 0
      let max = 0
      for (const item of node.items) {
        const w = widthOf(item)
        min += w.min
        max += w.max
      }
      return { min, max }
    }
    case 'alt': {
      const ws = node.options.map(widthOf)
      return { min: Math.min(...ws.map((w) => w.min)), max: Math.max(...ws.map((w) => w.max)) }
    }
    case 'repeat': {
      const w = widthOf(node.node)
      return { min: w.min * node.min, max: node.max === Infinity || w.max === Infinity ? (w.max === 0 ? 0 : Infinity) : w.max * node.max }
    }
  }
}

/**
 * 依序走訪所有 atom（包含 not 裡面的）。
 * @param {PatternNode} node
 * @returns {Generator<Extract<PatternNode, {type: 'atom'}>>}
 */
export function* atomsOf(node) {
  switch (node.type) {
    case 'atom':
      yield node
      return
    case 'not':
    case 'repeat':
      yield* atomsOf(node.node)
      return
    case 'seq':
      for (const x of node.items) yield* atomsOf(x)
      return
    case 'alt':
      for (const x of node.options) yield* atomsOf(x)
      return
    case 'anchor':
      return
  }
}

/**
 * 每一個比對成功的區間一定會用到的 atom（不在 not、可省略的部分或擇一的分支裡）。
 * 搜尋時先用它們篩出候選記錄：記錄中沒有任何一個詞符合其中一個 atom，就不可能比對成功。
 * @param {PatternNode} node
 * @returns {Array<Extract<PatternNode, {type: 'atom'}>>}
 */
export function requiredAtoms(node) {
  switch (node.type) {
    case 'atom':
      return node.atom.kind === 'any' ? [] : [node]
    case 'seq':
      return node.items.flatMap(requiredAtoms)
    case 'repeat':
      return node.min >= 1 ? requiredAtoms(node.node) : []
    case 'not':
    case 'alt':
    case 'anchor':
      return []
  }
}
