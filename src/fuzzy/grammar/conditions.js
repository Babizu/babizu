/**
 * @file 同位詞素的條件：受限的正規表達式子集，編譯成確定有限自動機（DFA）。
 *
 * 條件描述「加上這個同位詞素時，底層的基底必須長什麼樣子」（docs/morph-grammar.md 2.2）：
 * 前綴、中綴看基底開頭（`^…`），後綴看基底結尾（`…$`）。
 *
 * ```
 * 條件   ::= 分支 ( '|' 分支 )*            只有最外層可以用 |
 * 分支   ::= '^' 項* | 項* '$'             所有分支的錨點要相同
 * 項     ::= 類別 量詞?
 * 類別   ::= 'V' | 'C' | 字母 | '[' 字母+ ']' | '[^' 字母+ ']'
 * 量詞   ::= '*' | '+' | '?'
 * ```
 *
 * 例子：m- `^V`（元音開頭）、mu- `^C+[ua]`（輔音開頭、第一個元音是 u 或 a）、-un `uC*$`（最後一個元音是 u）。
 *
 * ## 語意
 * 分支匹配基底的一個**前綴**（`$` 錨點則是後綴：把基底與分支都反轉，變成前綴匹配）。條件成立 ⇔ 某個分支匹配。
 * `V` 是規格 `vowels` 中的字元，`C` 是其他字元（與重疊模板相同，滑音、喉塞音算輔音）。
 *
 * ## 為什麼自己編譯成 DFA，不用 JS 的 RegExp
 * RegExp 以回溯實作，巢狀量詞（例如 `(a+)+b`）最壞要指數時間，實務上等於不停止。這個子集沒有群組、
 * 沒有巢狀量詞，先編成 NFA（每個量詞一個新狀態，Thompson 構造），再以子集構造轉成 DFA：
 * 之後每讀一個字元只做一次查表。前綴匹配時「已接受」與「死狀態」都是吸收態，
 * 所以 DFA 一進入其中之一就可以停，不必讀完基底。
 *
 * ## 字母表
 * 字元集是開放的（任何 Unicode 字元都可能出現），所以 DFA 的轉移以**字元類別**為單位：
 * 條件中明確寫出的每個字母各自一類，其餘的元音一類、其餘的輔音一類。classOf(ch) 把字元對應到類別。
 */

/** DFA 狀態的判定：已接受（條件成立，之後不會改變）、死狀態（不可能成立）、未定 */
export const ACCEPT = 1
export const DEAD = -1
export const UNDECIDED = 0

/** 條件最長幾個字元（防止病態的規格；正常的條件不到 20 個字元） */
const MAX_SOURCE_LENGTH = 200
/** DFA 最多幾個狀態（子集構造理論上會指數成長；這個子集的條件實際上只有幾個狀態） */
const MAX_DFA_STATES = 256

const SPECIAL = new Set(['^', '$', '|', '[', ']', '*', '+', '?', '(', ')', '{', '}', '\\', '.'])

/**
 * @typedef {object} CharClass 一個字元類別
 * @property {'V' | 'C' | 'set'} kind
 * @property {Set<string>} [chars] kind 為 set 時的字元
 * @property {boolean} [negated] `[^…]`
 */

/**
 * @typedef {object} Condition 編譯後的條件
 * @property {string} source 原文
 * @property {'start' | 'end'} side 看基底開頭（start）或結尾（end）
 * @property {number} start DFA 的起始狀態
 * @property {(state: number, ch: string) => number} step 讀一個字元（side 為 end 時，由基底結尾往前讀）
 * @property {(state: number) => number} status ACCEPT、DEAD 或 UNDECIDED
 * @property {number} size DFA 的狀態數
 * @property {(base: string | string[]) => boolean} test 直接檢查一個基底（讀到吸收態就停；讀完仍未定則不成立）
 */

/**
 * 剖析並編譯一條條件。語法錯誤或超出子集時丟出錯誤（訊息指出位置）。
 * @param {string} source
 * @param {{vowels: string}} options vowels：元音字母
 * @returns {Condition}
 */
export function compileCondition(source, { vowels }) {
  if (typeof source !== 'string' || !source) throw new SyntaxError('條件必須是非空字串')
  if (source.length > MAX_SOURCE_LENGTH) throw new SyntaxError(`條件太長（超過 ${MAX_SOURCE_LENGTH} 個字元）`)
  const vowelSet = new Set(Array.from(vowels))
  const branches = source.split('|').map((b, k) => parseBranch(b, k, source))
  const sides = new Set(branches.map((b) => b.side))
  if (sides.size > 1) throw new SyntaxError(`條件「${source}」的分支錨點不一致：不能同時有 ^ 與 $`)
  const side = branches[0].side

  // 字元類別：條件中明確寫出的字母各自一類，其餘元音、其餘輔音各一類
  const mentioned = new Set()
  for (const b of branches) for (const item of b.items) if (item.cls.kind === 'set') for (const c of /** @type {Set<string>} */ (item.cls.chars)) mentioned.add(c)
  /** @type {string[]} 各類的代表字元：明確的字母，以及兩個虛擬字元（其餘元音、其餘輔音） */
  const OTHER_V = '\u0000V'
  const OTHER_C = '\u0000C'
  const reps = [...mentioned, OTHER_V, OTHER_C]
  const classIndex = new Map(reps.map((r, k) => [r, k]))
  const isVowelRep = (/** @type {string} */ r) => (r === OTHER_V ? true : r === OTHER_C ? false : vowelSet.has(r))
  /** @param {string} ch */
  const classOf = (ch) => classIndex.get(ch) ?? (vowelSet.has(ch) ? classIndex.get(OTHER_V) : classIndex.get(OTHER_C))
  /** @param {CharClass} cls @param {string} rep */
  const matches = (cls, rep) => {
    if (cls.kind === 'V') return isVowelRep(rep)
    if (cls.kind === 'C') return !isVowelRep(rep)
    const inSet = /** @type {Set<string>} */ (cls.chars).has(rep)
    return cls.negated ? !inSet : inSet
  }

  // NFA（Thompson 構造）：每個分支一條鏈；量詞的迴圈用新的中間狀態，避免相鄰項的迴圈互相串通
  /** @type {Array<{eps: number[], on: Array<{cls: CharClass, to: number}>}>} */
  const nfa = []
  const add = () => nfa.push({ eps: [], on: [] }) - 1
  const nfaStart = add()
  /** @type {Set<number>} */
  const finals = new Set()
  for (const b of branches) {
    let cur = add()
    nfa[nfaStart].eps.push(cur)
    for (const { cls, quant } of b.items) {
      const next = add()
      if (quant === '') nfa[cur].on.push({ cls, to: next })
      else if (quant === '?') {
        nfa[cur].on.push({ cls, to: next })
        nfa[cur].eps.push(next)
      } else {
        const loop = add()
        if (quant === '*') nfa[cur].eps.push(loop)
        else nfa[cur].on.push({ cls, to: loop }) // '+'：至少一次
        nfa[loop].on.push({ cls, to: loop })
        nfa[loop].eps.push(next)
      }
      cur = next
    }
    finals.add(cur)
  }

  /** @param {number[]} states */
  const closure = (states) => {
    const seen = new Set(states)
    const stack = [...states]
    while (stack.length) {
      const s = /** @type {number} */ (stack.pop())
      for (const t of nfa[s].eps) if (!seen.has(t)) (seen.add(t), stack.push(t))
    }
    return [...seen].sort((a, b) => a - b)
  }

  // 子集構造。前綴匹配：含 NFA 終點的集合就是「已接受」，當作單一吸收態
  /** @type {number[][]} */
  const table = [] // table[state][class] → state
  /** @type {number[]} */
  const statusOf = []
  const keyOf = new Map()
  const ACCEPT_STATE = 0
  const DEAD_STATE = 1
  table.push(reps.map(() => ACCEPT_STATE), reps.map(() => DEAD_STATE))
  statusOf.push(ACCEPT, DEAD)
  /** @param {number[]} set */
  const stateFor = (set) => {
    if (set.length === 0) return DEAD_STATE
    if (set.some((s) => finals.has(s))) return ACCEPT_STATE
    const key = set.join(',')
    let id = keyOf.get(key)
    if (id !== undefined) return id
    if (table.length >= MAX_DFA_STATES) throw new SyntaxError(`條件「${source}」的自動機太大（超過 ${MAX_DFA_STATES} 個狀態）`)
    id = table.length
    keyOf.set(key, id)
    table.push([])
    statusOf.push(UNDECIDED)
    const row = reps.map((rep) => {
      const moved = []
      for (const s of set) for (const { cls, to } of nfa[s].on) if (matches(cls, rep)) moved.push(to)
      return stateFor(closure(moved))
    })
    table[id] = row
    return id
  }
  const start = stateFor(closure([nfaStart]))

  /** @param {number} state @param {string} ch */
  const step = (state, ch) => table[state][/** @type {number} */ (classOf(ch))]
  /** @param {number} state */
  const status = (state) => statusOf[state]
  return {
    source,
    side,
    start,
    step,
    status,
    size: table.length,
    test(base) {
      const chars = typeof base === 'string' ? Array.from(base) : base
      let s = start
      const n = chars.length
      for (let k = 0; k < n && statusOf[s] === UNDECIDED; k++) s = step(s, chars[side === 'start' ? k : n - 1 - k])
      return statusOf[s] === ACCEPT
    },
  }
}

/**
 * 剖析一個分支。$ 錨點的分支把項目反轉，之後都當作前綴匹配處理。
 * @param {string} text
 * @param {number} index 第幾個分支（錯誤訊息用）
 * @param {string} source
 * @returns {{side: 'start' | 'end', items: Array<{cls: CharClass, quant: '' | '*' | '+' | '?'}>}}
 */
function parseBranch(text, index, source) {
  const where = `條件「${source}」的第 ${index + 1} 個分支`
  const chars = Array.from(text)
  const anchoredStart = chars[0] === '^'
  const anchoredEnd = chars[chars.length - 1] === '$'
  if (anchoredStart === anchoredEnd) throw new SyntaxError(`${where}必須以 ^ 開頭或以 $ 結尾（恰好一個）`)
  const body = anchoredStart ? chars.slice(1) : chars.slice(0, -1)
  if (body.length === 0) throw new SyntaxError(`${where}是空的（只有錨點，等於沒有條件）`)
  /** @type {Array<{cls: CharClass, quant: '' | '*' | '+' | '?'}>} */
  const items = []
  let k = 0
  while (k < body.length) {
    const c = body[k]
    /** @type {CharClass} */
    let cls
    if (c === 'V' || c === 'C') {
      cls = { kind: c }
      k++
    } else if (c === '[') {
      const close = body.indexOf(']', k + 1)
      if (close < 0) throw new SyntaxError(`${where}：[ 沒有對應的 ]`)
      let inner = body.slice(k + 1, close)
      const negated = inner[0] === '^'
      if (negated) inner = inner.slice(1)
      if (inner.length === 0) throw new SyntaxError(`${where}：[] 裡面至少要有一個字母`)
      for (const ch of inner) if (SPECIAL.has(ch) || /\s/u.test(ch)) throw new SyntaxError(`${where}：[] 裡面不能有「${ch}」`)
      cls = { kind: 'set', chars: new Set(inner), negated }
      k = close + 1
    } else if (SPECIAL.has(c) || /\s/u.test(c)) {
      throw new SyntaxError(`${where}：不支援「${c}」（只允許 V、C、字母、[…] 與單一類別上的 * + ?）`)
    } else {
      cls = { kind: 'set', chars: new Set([c]), negated: false }
      k++
    }
    /** @type {'' | '*' | '+' | '?'} */
    let quant = ''
    if (body[k] === '*' || body[k] === '+' || body[k] === '?') {
      quant = /** @type {'*' | '+' | '?'} */ (body[k])
      k++
      if (body[k] === '*' || body[k] === '+' || body[k] === '?') throw new SyntaxError(`${where}：不能連續使用量詞（巢狀量詞）`)
    }
    items.push({ cls, quant })
  }
  return { side: anchoredStart ? 'start' : 'end', items: anchoredStart ? items : items.reverse() }
}
