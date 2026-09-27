/**
 * @file 構詞文法 → BCDP 使用的平面結構（docs/morph-grammar.md 5.1）。
 *
 * BCDP（morph-search.js）與分析器（morphology.js）處理的是平面的詞綴清單：前綴、後綴各自自由串接，
 * 另有詞根上的中綴、重疊，以及緊貼詞根的環綴。文法多出來的東西都在這裡展開成這些結構：
 *
 * | 文法 | 編譯成 |
 * |---|---|
 * | 前綴、後綴、中綴、重疊的同位詞素（free） | 詞綴清單的一項，帶條件 |
 * | 落在前綴上的中綴（順序敏感、沒有組合規則） | 複合前綴：m ＋ <a> → "ma"，成本加 unattestedPenalty |
 * | 組合規則 | 環綴：左邊是複合前綴、詞根上的中綴或重疊，或沒有；右邊是複合後綴，或沒有 |
 *
 * ## 條件的部分求值
 * 每個同位詞素的條件看「加上它時的基底」（docs/morph-grammar.md 2.2、2.7）。組合規則裡，基底的一部分是
 * 先加上的詞綴——這些字串在編譯時就知道，所以條件的 DFA 先讀過它們：
 * - 讀完就決定了：成立就沒事；不成立就把 conditionPenalty 加進這一項的成本；
 * - 還沒決定：留下「剩下的狀態」，搜尋時再讀詞根（前綴那側由詞根開頭往後讀，後綴那側由詞根結尾往前讀）。
 * 留下的檢查記在 checks.start／checks.end，每個檢查有自己的懲罰：一般條件是 conditionPenalty，
 * 「只有輔音的前綴插入中綴時詞根必須是元音開頭」（2.7 第 1 項）是定義的一部分，懲罰是 Infinity（硬性限制）。
 *
 * ## 與舊版逐位元相同
 * 平面清單寫法的規格（grammar.source 為 legacy）編譯出的清單與舊版分析器完全相同：同樣的欄位、同樣的順序，
 * 不加 parts、checks。現有的語言設定檔搜尋結果因此不變（快照驗證）。
 */

import { ACCEPT, DEAD } from './conditions.js'
import { constructionShape } from './spec.js'

/** @typedef {import('./spec.js').Grammar} Grammar */
/** @typedef {import('./spec.js').Morpheme} Morpheme */
/** @typedef {import('./spec.js').Allomorph} Allomorph */
/** @typedef {import('./conditions.js').Condition} Condition */
/** @typedef {import('../morphology.js').Gloss} Gloss */

/** 編譯後的項目總數上限：超過是規格錯誤（docs/morph-grammar.md 第 4 節），不會默默截斷 */
export const MAX_COMPILED_ENTRIES = 20000

/**
 * @typedef {object} Part 一個項目由哪些詞素構成（推導順序），說明用
 * @property {string} id 詞素 id
 * @property {'prefix' | 'suffix' | 'infix' | 'reduplication'} type
 * @property {string} form 同位詞素的形式（重疊是型式）
 * @property {Gloss} gloss
 */

/**
 * @typedef {object} Check 搜尋時才能決定的條件：DFA 由 state 繼續讀詞根
 * @property {Condition} cond
 * @property {number} state
 * @property {number} penalty 不成立時加的成本（Infinity 表示硬性限制）
 * @property {Part | null} [owner] 這是哪一個同位詞素的條件（說明用；硬性限制沒有）
 */

/**
 * @typedef {object} Violation 一個不成立的條件（說明用，純資料）
 * @property {string} id 詞素 id
 * @property {string} form 同位詞素的形式
 * @property {string} when 條件原文
 * @property {number} penalty
 */

/**
 * @typedef {object} Checks
 * @property {Check[]} start 由詞根開頭往後讀（前綴、中綴那側）
 * @property {Check[]} end 由詞根結尾往前讀（後綴那側）
 */

/**
 * @typedef {object} CompiledAffix 詞綴清單的一項
 * @property {string} form
 * @property {Gloss} gloss
 * @property {number} cost
 * @property {boolean} [unattested] 沒有組合規則的順序敏感組合（落在前綴上的中綴），成本含 unattestedPenalty
 * @property {Part[]} [parts] 文法寫法才有
 * @property {Checks} [checks] 有條件才有
 * @property {Violation[]} [violations] 編譯時讀已知的詞綴就不成立的條件（懲罰已經加在 cost 裡）
 */

/**
 * @typedef {object} CompiledCircumfix 環綴（組合規則）
 * @property {'prefix' | 'infix' | 'reduplication' | 'none'} kind 左邊的種類；none 表示沒有左邊（只有後綴的組合規則）
 * @property {string} left 複合前綴、中綴的形式、重疊的型式；none 時是空字串
 * @property {string} suffix 複合後綴；沒有右邊（只有前綴的組合規則）時是空字串
 * @property {Gloss} gloss
 * @property {number} cost
 * @property {Part[]} [parts]
 * @property {{id: string, gloss: Gloss}} [construction]
 * @property {Checks} [checks]
 * @property {Violation[]} [violations]
 */

/**
 * @typedef {object} Compiled
 * @property {CompiledAffix[]} prefixes
 * @property {CompiledAffix[]} suffixes
 * @property {CompiledAffix[]} infixes
 * @property {Array<{pattern: import('../morphology.js').ReduplicationPattern, gloss: Gloss, cost: number, parts?: Part[], checks?: Checks}>} reduplication
 * @property {CompiledCircumfix[]} circumfixes
 * @property {number} size 項目總數
 */

/**
 * 條件讀過已知的字串之後的結果。
 * @param {Condition} cond
 * @param {string[]} chars 已知的字元，依 DFA 讀的順序（後綴那側要先反轉）
 * @returns {{status: number, state: number}}
 */
function advance(cond, chars) {
  let state = cond.start
  for (const ch of chars) {
    if (cond.status(state) !== 0) break
    state = cond.step(state, ch)
  }
  return { status: cond.status(state), state }
}

/**
 * 把一個條件放到「已知字串之後接詞根」的位置上：讀完已知的部分，決定了就回傳成本，沒決定就留下檢查。
 * @param {Condition | null} cond
 * @param {string[]} known 詞根之前（start）或之後（end）已經知道的字元，依 DFA 讀的順序
 * @param {number} penalty
 * @param {Acc} acc 累加
 * @param {Part} owner 這是哪一個同位詞素的條件
 */
function place(cond, known, penalty, acc, owner) {
  if (!cond) return
  const { status, state } = advance(cond, known)
  if (status === ACCEPT) return
  if (status === DEAD) {
    acc.cost += penalty
    acc.violations.push({ id: owner.id, form: owner.form, when: cond.source, penalty })
  } else acc[cond.side === 'start' ? 'start' : 'end'].push({ cond, state, penalty, owner })
}

/** @typedef {{cost: number, start: Check[], end: Check[], violations: Violation[]}} Acc */
/** @param {number} cost @returns {Acc} */
const newAcc = (cost) => ({ cost, start: [], end: [], violations: [] })

/** 項目上的條件欄位（沒有時省略，結果與沒有條件的版本相同） @param {Acc} acc */
const extrasOf = (acc) => ({
  ...(acc.start.length || acc.end.length ? { checks: { start: acc.start, end: acc.end } } : {}),
  ...(acc.violations.length ? { violations: acc.violations } : {}),
})

/**
 * 編譯文法。
 * @param {Grammar} g
 * @returns {Compiled}
 */
export function compileGrammar(g) {
  const legacy = g.source === 'legacy'
  const vowels = new Set(Array.from(g.vowels))
  /** 首輔音（群）的長度：第一個元音之前的字元數 @param {string[]} chars */
  const onsetLength = (chars) => {
    let k = 0
    while (k < chars.length && !vowels.has(chars[k])) k++
    return k
  }
  /** @param {Morpheme} m @param {Allomorph} a @returns {Part} */
  const part = (m, a) => ({ id: m.id, type: m.type, form: m.type === 'reduplication' ? /** @type {string} */ (a.pattern) : a.form, gloss: m.gloss })

  /** @type {Compiled} */
  const out = { prefixes: [], suffixes: [], infixes: [], reduplication: [], circumfixes: [], size: 0 }
  const count = () => {
    if (++out.size > MAX_COMPILED_ENTRIES) throw new RangeError(`構詞文法展開後超過 ${MAX_COMPILED_ENTRIES} 項：請減少詞素的同位詞素或組合規則（最多的是${largest()}）`)
  }
  /** 錯誤訊息用：展開最多的組合規則 */
  const largest = () => {
    const sizes = g.constructions.map((c) => [c.id, c.sequence.reduce((n, id) => n * (g.byId.get(id)?.allomorphs.length ?? 1), 1)])
    sizes.sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]))
    return sizes.length ? `組合規則「${sizes[0][0]}」（${sizes[0][1]} 種）` : '自由的詞綴'
  }

  // ── 自由的詞素：一個同位詞素一項 ──
  for (const m of g.morphemes) {
    if (!m.free) continue
    for (const a of m.allomorphs) {
      count()
      if (legacy) {
        if (m.type === 'reduplication') out.reduplication.push({ pattern: /** @type {any} */ (a.pattern), gloss: m.gloss, cost: m.cost })
        else out[m.type === 'prefix' ? 'prefixes' : m.type === 'suffix' ? 'suffixes' : 'infixes'].push({ form: a.form, gloss: m.gloss, cost: m.cost })
        continue
      }
      const acc = newAcc(m.cost)
      place(a.condition, [], g.conditionPenalty, acc, part(m, a))
      const entry = { gloss: m.gloss, cost: acc.cost, parts: [part(m, a)], ...extrasOf(acc) }
      if (m.type === 'reduplication') out.reduplication.push({ pattern: /** @type {any} */ (a.pattern), ...entry })
      else out[m.type === 'prefix' ? 'prefixes' : m.type === 'suffix' ? 'suffixes' : 'infixes'].push({ form: a.form, ...entry })
    }
  }

  // ── 落在前綴上的中綴（順序敏感、沒有組合規則）：複合前綴 ──
  if (!legacy) {
    for (const p of g.morphemes) {
      if (!p.free || p.type !== 'prefix') continue
      for (const x of g.morphemes) {
        if (!x.free || x.type !== 'infix') continue
        for (const pa of p.allomorphs) {
          for (const xa of x.allomorphs) {
            const composite = insertIntoPrefixes([pa.form], xa.form, onsetLength)
            count()
            const acc = newAcc(p.cost + x.cost + g.unattestedPenalty)
            place(pa.condition, [], g.conditionPenalty, acc, part(p, pa)) // 前綴的基底是詞根
            place(xa.condition, Array.from(pa.form), g.conditionPenalty, acc, part(x, xa)) // 中綴的基底是 前綴·詞根
            if (composite.needsVowel) acc.start.push(vowelInitial(g.vowels))
            out.prefixes.push({ form: composite.form, gloss: null, cost: acc.cost, parts: [part(p, pa), part(x, xa)], unattested: true, ...extrasOf(acc) })
          }
        }
      }
    }
  }

  // ── 組合規則：每一種同位詞素的選擇一項 ──
  for (const c of g.constructions) {
    const members = c.sequence.map((id) => /** @type {Morpheme} */ (g.byId.get(id)))
    const shape = constructionShape(members.map((m) => m.type))
    for (const choice of product(members.map((m) => m.allomorphs))) {
      count()
      const acc = newAcc(c.cost)
      const parts = members.map((m, k) => part(m, choice[k]))
      /** @type {string[]} 前綴那側已加上的字元（由外而內，也就是詞中的順序） */
      let material = []
      /** @type {string[]} 後綴那側已加上的字元（詞中的順序） */
      let suffixes = []
      let needsVowel = false
      /** @type {CompiledCircumfix['kind']} */
      let kind = shape.kind === 'stem' ? /** @type {any} */ (members[0].type) : shape.kind === 'prefix' ? 'prefix' : 'none'
      let left = shape.kind === 'stem' ? (members[0].type === 'reduplication' ? /** @type {string} */ (choice[0].pattern) : choice[0].form) : ''
      members.forEach((m, k) => {
        const a = choice[k]
        if (m.type === 'suffix') {
          // 後綴的基底是 詞根·先加的後綴：條件由結尾往前讀已知的後綴，剩下的再讀詞根
          place(a.condition, [...suffixes].reverse(), g.conditionPenalty, acc, parts[k])
          suffixes = [...suffixes, ...Array.from(a.form)]
        } else if (shape.kind === 'stem' && k === 0) {
          place(a.condition, [], g.conditionPenalty, acc, parts[k]) // 詞根上的中綴、重疊：基底就是詞根
        } else if (m.type === 'prefix') {
          place(a.condition, material, g.conditionPenalty, acc, parts[k])
          material = [...Array.from(a.form), ...material]
        } else {
          // 落在前綴上的中綴
          place(a.condition, material, g.conditionPenalty, acc, parts[k])
          const r = insertIntoPrefixes([material.join('')], a.form, onsetLength)
          material = Array.from(r.form)
          needsVowel = r.needsVowel
        }
      })
      if (shape.kind === 'prefix') left = material.join('')
      if (needsVowel) acc.start.push(vowelInitial(g.vowels))
      /** @type {CompiledCircumfix} */
      const entry = { kind, left, suffix: suffixes.join(''), gloss: c.gloss, cost: acc.cost }
      if (!legacy) {
        entry.parts = parts
        entry.construction = { id: c.id, gloss: c.gloss }
        Object.assign(entry, extrasOf(acc))
      }
      out.circumfixes.push(entry)
    }
  }
  return out
}

/**
 * 在前綴那側的材料上插入中綴（docs/morph-grammar.md 2.3、2.7 第 1 項）：插在首輔音（群）之後。
 * 材料全是輔音時，中綴要緊接在材料之後，這只在詞根以元音開頭時成立（needsVowel）。
 * @param {string[]} material 前綴那側的字串（只有一段，陣列是為了之後擴充）
 * @param {string} infix
 * @param {(chars: string[]) => number} onsetLength
 */
function insertIntoPrefixes(material, infix, onsetLength) {
  const chars = Array.from(material.join(''))
  const h = onsetLength(chars)
  if (h < chars.length) return { form: [...chars.slice(0, h), ...Array.from(infix), ...chars.slice(h)].join(''), needsVowel: false }
  return { form: chars.join('') + infix, needsVowel: true }
}

/**
 * 「詞根以元音開頭」的硬性檢查（Infinity 懲罰）。
 * @param {string} vowels
 * @returns {Check}
 */
function vowelInitial(vowels) {
  const set = new Set(Array.from(vowels))
  /** @type {Condition} */
  const cond = {
    source: '^V',
    side: 'start',
    start: 0,
    step: (_state, ch) => (set.has(ch) ? 1 : 2),
    status: (state) => (state === 0 ? 0 : state === 1 ? ACCEPT : DEAD),
    size: 3,
    test: (base) => set.has(Array.from(base)[0] ?? ''),
  }
  return { cond, state: 0, penalty: Infinity, owner: null }
}

/**
 * 笛卡兒積（依序列舉）。
 * @template T
 * @param {T[][]} lists
 * @returns {Generator<T[]>}
 */
function* product(lists) {
  if (lists.length === 0) {
    yield []
    return
  }
  const [head, ...rest] = lists
  for (const x of head) for (const tail of product(rest)) yield [x, ...tail]
}
