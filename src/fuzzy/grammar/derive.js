/**
 * @file 推導產生器：詞根 ＋ 依序套用的詞素 → 表面形式、詞素界線、條件的結果（docs/morph-grammar.md 2.3）。
 *
 * 這是文法語意的「直接定義」，刻意寫得簡單、不求快：測試、類 pika 剖析器的仲裁、說明的重建都以它為準。
 *
 * 每個運算套用在當時的基底上：
 * - 前綴 p：p · b；後綴 s：b · s
 * - 中綴 x：插在 b 的首輔音（群）之後；b 以元音開頭則在最前面
 * - 重疊：依模板由 b 的開頭產生重疊部分，放在 b 前面
 *
 * **條件讀的範圍**（docs/morph-grammar.md 2.7 第 3 項與 G0 的決定）：
 * - 前綴、中綴、重疊的條件由它之後讀到詞根結尾：先加的前綴、詞根，不含後綴；
 * - 後綴的條件由它之前往前讀到詞根開頭：先加的後綴、詞根，不含前綴；
 * - 直接加在詞根上的中綴、重疊（在查詢端還原的部分）略過不讀；
 * - 讀完仍未決定＝不成立。
 */

import { ACCEPT } from './conditions.js'

/** @typedef {import('./spec.js').Grammar} Grammar */
/** @typedef {import('./spec.js').Morpheme} Morpheme */

/**
 * @typedef {object} Op 一個運算：哪個詞素的哪個同位詞素
 * @property {string} id 詞素 id
 * @property {number} [allomorph=0] 同位詞素的序號
 */

/**
 * @typedef {object} Derived
 * @property {string} surface 表面形式（還沒有音變）
 * @property {Array<{ch: string, owner: number}>} chars 每個字元來自哪一個運算（-1 是詞根）
 * @property {number[]} junctions 交界的位置（相鄰兩個字元來自不同的運算）
 * @property {boolean[]} satisfied 每個運算的條件是否成立（沒有條件＝成立）
 * @property {boolean} valid 推導是否成立：重疊模板都適用
 */

/**
 * 依序套用運算。
 * @param {Grammar} g
 * @param {string} root
 * @param {Op[]} ops 推導順序（由內而外）
 * @returns {Derived}
 */
export function derive(g, root, ops) {
  const vowels = new Set(Array.from(g.vowels))
  /** @type {Array<{ch: string, owner: number, side: 'prefix' | 'root' | 'suffix' | 'stemop'}>} */
  let chars = Array.from(root).map((ch) => ({ ch, owner: -1, side: /** @type {const} */ ('root') }))
  /** @type {boolean[]} */
  const satisfied = []
  let valid = true
  ops.forEach((op, k) => {
    const m = /** @type {Morpheme} */ (g.byId.get(op.id))
    if (!m) throw new RangeError(`不存在的詞素「${op.id}」`)
    const a = m.allomorphs[op.allomorph ?? 0]
    // 直接加在詞根上（還沒有任何運算）的中綴、重疊是詞根上的非串接運算，它的字元在查詢端還原
    const stemLevel = k === 0 && (m.type === 'infix' || m.type === 'reduplication')
    // 條件：由這個運算的位置讀基底（前綴那側讀到詞根結尾、後綴那側讀到詞根開頭），略過詞根上的非串接部分
    if (a.condition) {
      const cond = a.condition
      const readable =
        cond.side === 'start' ? chars.filter((c) => c.side !== 'suffix' && c.side !== 'stemop') : chars.filter((c) => c.side !== 'prefix' && c.side !== 'stemop').reverse()
      let s = cond.start
      for (const c of readable) {
        if (cond.status(s) !== 0) break
        s = cond.step(s, c.ch)
      }
      satisfied.push(cond.status(s) === ACCEPT)
    } else satisfied.push(true)

    if (m.type === 'prefix') chars = [...Array.from(a.form).map((ch) => ({ ch, owner: k, side: /** @type {const} */ ('prefix') })), ...chars]
    else if (m.type === 'suffix') chars = [...chars, ...Array.from(a.form).map((ch) => ({ ch, owner: k, side: /** @type {const} */ ('suffix') }))]
    else if (m.type === 'infix') {
      let h = 0
      while (h < chars.length && !vowels.has(chars[h].ch)) h++
      // 落在前綴上（插入點 h 在前綴那側的材料之內或正好在它的結尾）屬於前綴那側；
      // 首輔音延伸進詞根時落在詞根上，等於詞根上的中綴（docs/morph-grammar.md 2.7 第 1 項）
      let p = 0
      while (p < chars.length && chars[p].side === 'prefix') p++
      const side = !stemLevel && p > 0 && h <= p ? 'prefix' : 'stemop'
      chars = [...chars.slice(0, h), ...Array.from(a.form).map((ch) => ({ ch, owner: k, side: /** @type {any} */ (side) })), ...chars.slice(h)]
    } else {
      const red = reduplicant(/** @type {any} */ (a.pattern), chars.map((c) => c.ch), vowels)
      if (red === null) valid = false
      else chars = [...Array.from(red).map((ch) => ({ ch, owner: k, side: /** @type {any} */ (stemLevel ? 'stemop' : 'prefix') })), ...chars]
    }
  })
  /** @type {number[]} */
  const junctions = []
  for (let x = 1; x < chars.length; x++) if (chars[x].owner !== chars[x - 1].owner) junctions.push(x)
  return { surface: chars.map((c) => c.ch).join(''), chars: chars.map(({ ch, owner }) => ({ ch, owner })), junctions, satisfied, valid }
}

/**
 * 重疊部分（與 morphology.js 的模板相同的定義；這裡獨立實作，作為參考）。
 * @param {'Ca' | 'CV' | 'CVV' | 'CVCV' | 'CVCVC' | 'full'} pattern
 * @param {string[]} base
 * @param {Set<string>} vowels
 * @returns {string | null}
 */
export function reduplicant(pattern, base, vowels) {
  const n = base.length
  if (pattern === 'full') return base.join('')
  let v1 = 0
  while (v1 < n && !vowels.has(base[v1])) v1++
  if (pattern === 'Ca') return base.slice(0, v1).join('') + 'a'
  if (v1 === n) return null
  if (pattern === 'CV') return base.slice(0, v1 + 1).join('')
  if (pattern === 'CVV') return base.slice(0, v1 + 1).join('') + base[v1]
  let k = v1
  while (k < n && vowels.has(base[k])) k++
  while (k < n && !vowels.has(base[k])) k++
  if (k >= n) return null
  while (k < n && vowels.has(base[k])) k++
  if (pattern === 'CVCVC') while (k < n && !vowels.has(base[k])) k++
  return base.slice(0, k).join('')
}
