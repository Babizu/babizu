/**
 * 句型比對器（src/pattern/match.js）：語意與 JavaScript RegExp 的 g 旗標相同。
 * 性質測試把每個詞當成一個字母，隨機產生句型，與同義的 RegExp 比較找到的區間；
 * 另外檢查還原出來的每一格都由符合它的 atom 比到。
 */

import { describe, expect, it } from 'vitest'
import { widthOf } from '../../src/pattern/ast.js'
import { findMatches, matchesAnywhere } from '../../src/pattern/match.js'
import { parsePattern } from '../../src/pattern/parser.js'

/** 亂數產生器（固定種子） @param {number} seed */
function createRandom(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f']

/**
 * 測試用的 atom：一組字母（null 表示任一個詞 _）。
 * @typedef {import('../../src/pattern/ast.js').PatternNode} Node
 */

/** @param {() => number} random @param {number} depth @returns {Node} */
function randomNode(random, depth) {
  const r = random()
  const atom = () => {
    if (random() < 0.15) return /** @type {Node} */ ({ type: 'atom', atom: { kind: 'any' }, letters: null, start: 0, end: 0 })
    const letters = LETTERS.filter(() => random() < 0.35)
    if (letters.length === 0) letters.push(LETTERS[Math.floor(random() * LETTERS.length)])
    return /** @type {Node} */ ({ type: 'atom', atom: { kind: 'word', text: letters.join('') }, letters, start: 0, end: 0 })
  }
  if (depth <= 0 || r < 0.35) {
    if (random() < 0.15) return { type: 'not', node: atom(), start: 0, end: 0 }
    if (random() < 0.06) return { type: 'anchor', at: random() < 0.5 ? 'start' : 'end', start: 0, end: 0 }
    return atom()
  }
  if (r < 0.6) return { type: 'seq', items: Array.from({ length: 2 + Math.floor(random() * 2) }, () => randomNode(random, depth - 1)), start: 0, end: 0 }
  if (r < 0.8) return { type: 'alt', options: Array.from({ length: 2 + Math.floor(random() * 2) }, () => randomNode(random, depth - 1)), start: 0, end: 0 }
  const [min, max] = [
    [0, 1],
    [0, Infinity],
    [1, Infinity],
    [2, 3],
    [1, 2],
    [0, 2],
  ][Math.floor(random() * 6)]
  let body = randomNode(random, depth - 1)
  // 重複的部分至少佔一個詞（剖析時的規則）
  while (widthOf(body).min === 0) body = randomNode(random, depth - 1)
  return { type: 'repeat', node: body, min, max, start: 0, end: 0 }
}

/** 同義的 RegExp 原始碼 @param {Node} node @returns {string} */
function toRegExp(node) {
  switch (node.type) {
    case 'atom': {
      const letters = /** @type {any} */ (node).letters
      return letters ? `[${letters.join('')}]` : '.'
    }
    case 'not': {
      const letters = /** @type {any} */ (node.node).letters
      return letters ? `[^${letters.join('')}]` : '[^\\s\\S]'
    }
    case 'anchor':
      return node.at === 'start' ? '^' : '$'
    case 'seq':
      return node.items.map((x) => `(?:${toRegExp(x)})`).join('')
    case 'alt':
      return `(?:${node.options.map(toRegExp).join('|')})`
    case 'repeat':
      return `(?:${toRegExp(node.node)}){${node.min},${node.max === Infinity ? '' : node.max}}`
  }
}

/** @param {any} node @param {string} letter */
const accepts = (node, letter) => node.letters === null || node.letters.includes(letter)

describe('比對器：與 RegExp 的 g 旗標相同（最左、優先序、不重疊）', () => {
  it('隨機句型與隨機句子（20,000 組）', () => {
    const random = createRandom(20261002)
    let compared = 0
    let nonEmpty = 0
    for (let t = 0; t < 20000; t++) {
      const root = randomNode(random, 3)
      if (widthOf(root).min === 0) continue
      const words = Array.from({ length: Math.floor(random() * 9) }, () => LETTERS[Math.floor(random() * 4)])
      const text = words.join('')
      const re = new RegExp(toRegExp(root), 'gu')
      const want = [...text.matchAll(re)].map((m) => [/** @type {number} */ (m.index), /** @type {number} */ (m.index) + m[0].length])
      const spans = findMatches(root, words.length, (atom, i) => accepts(atom, words[i]))
      expect(
        spans.map((s) => [s.start, s.end]),
        `${toRegExp(root)} on ${text}`,
      ).toEqual(want)
      expect(matchesAnywhere(root, words.length, (atom, i) => accepts(atom, words[i]))).toBe(want.length > 0)
      // 每一格都由符合它的 atom 比到，而且正好涵蓋整個區間
      for (const s of spans) {
        expect(s.cells.map((c) => c.index)).toEqual(Array.from({ length: s.end - s.start }, (_, k) => s.start + k))
        for (const c of s.cells) {
          if (c.node.type === 'not') expect(accepts(c.node.node, words[c.index])).toBe(false)
          else expect(accepts(c.node, words[c.index])).toBe(true)
        }
      }
      compared++
      if (want.length) nonEmpty++
    }
    expect(compared).toBeGreaterThan(15000)
    expect(nonEmpty).toBeGreaterThan(5000)
  })
})

describe('比對器：維護者的例子（詞以完全相同比對）', () => {
  /** @param {string} q @param {string} sentence */
  const run = (q, sentence) => {
    const words = sentence.split(' ')
    const { conditions } = parsePattern(q)
    return findMatches(conditions[0].body, words.length, (atom, i) => atom.atom.kind === 'any' || (/** @type {any} */ (atom.atom).text === words[i])).map((s) => words.slice(s.start, s.end).join(' '))
  }

  it('yaku ka _* isiw：中間隔任意幾個詞（貪婪：延伸到同一句最後一個 isiw）', () => {
    expect(run('yaku ka _* isiw', 'yaku ka hapet isiw')).toEqual(['yaku ka hapet isiw'])
    expect(run('yaku ka _* isiw', 'yaku ka mausay mikita isiw a mamai kuasayan nahaza ezaw isiw')).toEqual([
      'yaku ka mausay mikita isiw a mamai kuasayan nahaza ezaw isiw',
    ])
    expect(run('yaku ka _* isiw', 'yaku ka isiw')).toEqual(['yaku ka isiw'])
    expect(run('yaku ka _+ isiw', 'yaku ka isiw')).toEqual([])
    expect(run('yaku ka _{0,2} isiw', 'yaku ka mausay mikita isiw')).toEqual(['yaku ka mausay mikita isiw'])
    expect(run('yaku ka _{0,1} isiw', 'yaku ka mausay mikita isiw')).toEqual([])
  })

  it('不重疊：下一次從上一次的終點接著找', () => {
    expect(run('ki _', 'ki hapuy ki ki hapuy')).toEqual(['ki hapuy', 'ki ki'])
  })

  it('錨點與 !', () => {
    expect(run('^ ki', 'ki hapuy ki')).toEqual(['ki'])
    expect(run('ki $', 'ki hapuy ki')).toEqual(['ki'])
    expect(run('!ki hapuy', 'ki hapuy mutiuk hapuy')).toEqual(['mutiuk hapuy'])
    expect(run('(ki|ni) hapuy', 'ni hapuy')).toEqual(['ni hapuy'])
    expect(run('ki/ni hapuy', 'ni hapuy')).toEqual(['ni hapuy'])
  })
})
