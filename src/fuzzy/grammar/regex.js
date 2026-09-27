/**
 * @file 正規表達式能做什麼、不能做什麼（docs/morph-grammar.md 第 6 節）：把文法編譯成 JS RegExp 的原型。
 *
 * 網站不使用這個模組。它有兩個用途：
 * 1. **第三個獨立的檢查者**：只管「完全相符」（對齊成本 0、沒有音變）的分析。
 *    推導產生器產生的每個字串都要被它認得；類 pika 剖析器找到的對齊成本為 0 的分析也是（測試逐一檢查）。
 * 2. **量出界線**：正規表達式的大小與時間，以及它做不到的事——加權的模糊比對、列舉所有分析、取最小成本。
 *
 * ## 完全相符的檢查（詞根已知）
 * 詞根 t 已知時，「查詢 q 是否是 t 的某個零音變衍生形」是正規語言的成員問題：
 *
 *   ^(?:前綴單位){0,S} (?:t｜詞根上的運算 op(t)｜組合規則) (?:後綴單位){0,S}$
 *
 * - 前綴單位：自由的前綴，以及落在前綴上的中綴（複合前綴）。只有輔音的前綴插入中綴（m ＋ <a> → ma）
 *   只在後面以元音開頭時成立（2.7 第 1 項），正好是一個**向前看** `(?=[元音])`。
 * - 詞根上的運算與詞根上的組合規則：詞根已知，所以直接由推導產生器算出表面（重疊也是）。
 * - 同位詞素的條件只影響成本，不影響「有沒有這種分析」，這裡不看。
 * 由上而下的回溯比對在這裡一定停止：量詞都有上限 S，每個單位非空，所以嘗試的組合是有限的；
 * 但它是指數的（見 docs 第 6 節的量測），這也是條件語言不用 RegExp、改用 DFA 的原因。
 *
 * ## 詞根未知（搜尋）
 * compileSearchRegex 用具名群組抓出前綴、詞根、後綴，重疊以**反向參照**表達（`(?<red>C*V)(?=\k<red>)`：
 * 重疊部分等於它後面的開頭，這已經超出正規語言）。但 exec 只回傳**一個**分析（回溯最先成功的那個），
 * 不能列舉所有分析、不能要求詞根在詞庫裡、也沒有成本——這正是搜尋需要的三件事。
 */

import { derive } from './derive.js'

/** @typedef {import('./spec.js').Grammar} Grammar */

/** 私用區的字元：推導產生器的探測詞根用（不是元音，不會出現在詞綴裡） */
const PROBE = '\uE000'

/** 字串原樣比對（u 旗標下只能跳脫語法字元） @param {string} s */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
/** 字元類別裡的一個字元 @param {string} s */
const escClass = (s) => s.replace(/[\]\\^-]/g, '\\$&')

/**
 * 以探測詞根推導，取出詞根左右的材料；詞根被拆開（中綴落進詞根）時回傳 null。
 * @param {Grammar} g
 * @param {Array<{id: string, allomorph: number}>} ops
 * @param {string[]} root
 */
function sides(g, ops, root) {
  const d = derive(g, root.join(''), ops)
  if (!d.valid) return null
  const at = d.chars.flatMap((c, k) => (c.owner === -1 ? [k] : []))
  if (at.length !== root.length || at[at.length - 1] - at[0] !== root.length - 1) return null
  return { left: d.chars.slice(0, at[0]).map((c) => c.ch).join(''), right: d.chars.slice(at[at.length - 1] + 1).map((c) => c.ch).join('') }
}

/**
 * 文法中與詞根無關的部分：前綴單位、後綴單位（正規表達式片段）、前綴式組合規則的左右、詞根上的運算。
 * @param {Grammar} g
 */
function pieces(g) {
  const V = `[${Array.from(g.vowels).map(escClass).join('')}]`
  const vowel = g.vowels[0] ?? 'a'
  /**
   * 左邊的材料：元音開頭的探測詞根上成立；輔音開頭的不成立（或形式不同）時，要求後面以元音開頭
   * @param {Array<{id: string, allomorph: number}>} ops
   */
  const leftOf = (ops) => {
    const withV = sides(g, ops, [vowel, PROBE, vowel])
    if (!withV) return null
    const withC = sides(g, ops, [PROBE, vowel, PROBE])
    const needsVowel = !withC || withC.left !== withV.left || withC.right !== withV.right
    return { left: esc(withV.left) + (needsVowel ? `(?=${V})` : ''), right: esc(withV.right) }
  }
  /** @type {string[]} */
  const prefixes = []
  /** @type {string[]} */
  const suffixes = []
  /** @type {Array<Array<{id: string, allomorph: number}>>} 詞根上的運算（自由的，或組合規則，推導順序） */
  const stemOps = []
  /** @type {Array<{left: string, right: string}>} */
  const constructions = []
  for (const m of g.morphemes) {
    if (!m.free) continue
    m.allomorphs.forEach((a, k) => {
      if (m.type === 'prefix') prefixes.push(esc(a.form))
      else if (m.type === 'suffix') suffixes.push(esc(a.form))
      else stemOps.push([{ id: m.id, allomorph: k }])
    })
  }
  // 落在前綴上的中綴（平面清單寫法沒有這種組合，與 compile.js、chart.js 相同）
  for (const p of g.source === 'legacy' ? [] : g.morphemes) {
    if (!p.free || p.type !== 'prefix') continue
    for (const x of g.morphemes) {
      if (!x.free || x.type !== 'infix') continue
      p.allomorphs.forEach((_, pk) =>
        x.allomorphs.forEach((__, xk) => {
          const s = leftOf([
            { id: p.id, allomorph: pk },
            { id: x.id, allomorph: xk },
          ])
          if (s && !s.right) prefixes.push(s.left)
        }),
      )
    }
  }
  for (const c of g.constructions) {
    const members = c.sequence.map((id) => /** @type {import('./spec.js').Morpheme} */ (g.byId.get(id)))
    const stemFirst = members[0].type === 'infix' || members[0].type === 'reduplication'
    /** @param {number} k @param {number[]} choice */
    const walk = (k, choice) => {
      if (k < members.length) {
        for (let a = 0; a < members[k].allomorphs.length; a++) walk(k + 1, [...choice, a])
        return
      }
      const ops = members.map((m, j) => ({ id: m.id, allomorph: choice[j] }))
      if (stemFirst) stemOps.push(ops)
      else {
        const s = leftOf(ops)
        if (s) constructions.push(s)
      }
    }
    walk(0, [])
  }
  return { V, prefixes, suffixes, stemOps, constructions }
}

/** 片段的聯集（沒有片段時是「永遠不成立」，包在群組裡才能加量詞） @param {string[]} list */
const any = (list) => (list.length ? `(?:${[...new Set(list)].join('|')})` : '(?:(?!))')

/**
 * 完全相符的檢查器：詞根 root 已知時，查詢是不是它的零音變衍生形。
 * @param {Grammar} g
 * @param {string} root
 * @returns {{regex: RegExp, source: string}}
 */
export function compileExactRegex(g, root) {
  const { prefixes, suffixes, stemOps, constructions } = pieces(g)
  /** 詞根與詞根上的運算（重疊、中綴、詞根上的組合規則）：詞根已知，表面由推導產生器算出 */
  const cores = [esc(root)]
  for (const ops of stemOps) {
    const d = derive(g, root, ops)
    if (d.valid) cores.push(esc(d.surface))
  }
  for (const c of constructions) cores.push(c.left + esc(root) + c.right)
  const S = g.maxSteps
  const source = `^${any(prefixes)}{0,${S}}${any(cores)}${any(suffixes)}{0,${S}}$`
  return { regex: new RegExp(source, 'u'), source }
}

/**
 * 詞根未知的版本（搜尋）：前綴、詞根、後綴各是一個具名群組；重疊以反向參照表達。
 * 只示範正規表達式的界線：exec 只回傳一個分析，不能列舉、不能取最小成本、不能要求詞根在詞庫裡。
 * 只支援 CV、Ca 兩種重疊型式（其他型式的寫法相同，只是更長）。
 * @param {Grammar} g
 * @returns {{regex: RegExp, source: string}}
 */
export function compileSearchRegex(g) {
  const { V, prefixes, suffixes } = pieces(g)
  const C = `[^${V.slice(1, -1)}]`
  const S = g.maxSteps
  /** @type {string[]} */
  const reds = []
  for (const m of g.morphemes) {
    if (!m.free || m.type !== 'reduplication') continue
    for (const a of m.allomorphs) {
      // 重疊部分等於詞根的開頭（CV），或詞根的首輔音加 a（Ca）：以向前看 ＋ 反向參照檢查
      if (a.pattern === 'CV' && !reds.some((r) => r.startsWith('(?<cv>'))) reds.push(`(?<cv>${C}*${V})(?=\\k<cv>)`)
      if (a.pattern === 'Ca' && !reds.some((r) => r.startsWith('(?<ca>'))) reds.push(`(?<ca>${C}*)a(?=\\k<ca>${V})`)
    }
  }
  const red = reds.length ? `(?<red>${reds.join('|')})?` : ''
  const source = `^(?<prefixes>${any(prefixes)}{0,${S}})${red}(?<root>.+?)(?<suffixes>${any(suffixes)}{0,${S}})$`
  return { regex: new RegExp(source, 'u'), source }
}
