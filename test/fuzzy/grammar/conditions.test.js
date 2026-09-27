/**
 * 同位詞素的條件（src/fuzzy/grammar/conditions.js）：受限的正規表達式子集 → DFA。
 * 參考答案是 JS 的 RegExp：這個子集沒有巢狀量詞，RegExp 不會回溯爆量，可以放心當仲裁者。
 */

import { describe, expect, it } from 'vitest'
import { ACCEPT, DEAD, UNDECIDED, compileCondition } from '../../../src/fuzzy/grammar/conditions.js'
import { createRandom, pick, randomString } from '../helpers.js'

const VOWELS = 'aeiou'
const opts = { vowels: VOWELS }

/** 條件 → 等價的 RegExp（仲裁用）：V、C 換成字元類別，^ 錨點是前綴匹配，$ 錨點是後綴匹配 @param {string} source */
function toRegExp(source) {
  const branches = source.split('|').map((b) => {
    const start = b.startsWith('^')
    const body = (start ? b.slice(1) : b.slice(0, -1)).replaceAll('V', `[${VOWELS}]`).replaceAll('C', `[^${VOWELS}]`)
    return start ? `^(?:${body})` : `(?:${body})$`
  })
  return new RegExp(branches.join('|'), 'u')
}

/** 隨機產生子集內的條件 @param {() => number} random */
function randomCondition(random) {
  const side = random() < 0.5 ? 'start' : 'end'
  const branches = 1 + Math.floor(random() * 2)
  const parts = []
  for (let b = 0; b < branches; b++) {
    const items = 1 + Math.floor(random() * 4)
    let body = ''
    for (let k = 0; k < items; k++) {
      body += pick(random, ['V', 'C', 'a', 'u', 'k', '[ua]', '[^ai]', '[bk]'])
      body += pick(random, ['', '', '*', '+', '?'])
    }
    parts.push(side === 'start' ? `^${body}` : `${body}$`)
  }
  return parts.join('|')
}

describe('條件語言', () => {
  it('例子：m- 接元音開頭；mu- 接輔音開頭且第一個元音是 u 或 a；-un 接最後一個元音是 u 的基底', () => {
    const m = compileCondition('^V', opts)
    expect(m.test('usa')).toBe(true)
    expect(m.test('baket')).toBe(false)
    const mu = compileCondition('^C+[ua]', opts)
    expect(['baket', 'kuzu', 'tsuba'].map((w) => mu.test(w))).toEqual([true, true, true])
    expect(['kita', 'usa', 'depex'].map((w) => mu.test(w))).toEqual([false, false, false])
    const un = compileCondition('uC*$', opts)
    expect(un.side).toBe('end')
    expect(['bitud', 'kawas', 'daux'].map((w) => un.test(w))).toEqual([true, false, true])
  })

  it('與 RegExp 逐一相同（隨機條件 × 隨機基底）', () => {
    const random = createRandom(17)
    const alphabet = ['a', 'e', 'i', 'u', 'b', 'k', 'm', 'y', "'"]
    for (let c = 0; c < 400; c++) {
      const source = randomCondition(random)
      const cond = compileCondition(source, opts)
      const re = toRegExp(source)
      for (let k = 0; k < 40; k++) {
        const base = randomString(random, alphabet, 0, 7)
        expect(cond.test(base), `${source} / ${base}`).toBe(re.test(base))
      }
    }
  })

  it('逐字元前進：已接受與死狀態是吸收態，所以一進入就可以停', () => {
    const random = createRandom(5)
    for (let c = 0; c < 100; c++) {
      const cond = compileCondition(randomCondition(random), opts)
      for (let s = 0; s < cond.size; s++) {
        const st = cond.status(s)
        if (st === UNDECIDED) continue
        for (const ch of ['a', 'b', 'u', 'x']) expect(cond.status(cond.step(s, ch))).toBe(st)
      }
    }
    expect(compileCondition('^V', opts).status(compileCondition('^V', opts).start)).toBe(UNDECIDED)
    const m = compileCondition('^V', opts)
    expect(m.status(m.step(m.start, 'a'))).toBe(ACCEPT)
    expect(m.status(m.step(m.start, 'b'))).toBe(DEAD)
  })

  it('字母表是開放的：條件沒有寫出的字元依元音、輔音歸類', () => {
    const cond = compileCondition('^C+[ua]', { vowels: 'aeiouə' })
    expect(cond.test('ŋu')).toBe(true)
    expect(cond.test('bə')).toBe(false) // ə 是元音但不是 u、a
  })

  it('超出子集的寫法都被拒絕，錯誤訊息指出原因', () => {
    for (const [source, message] of [
      ['V', /\^ 開頭或以 \$ 結尾/],
      ['^V$', /恰好一個/],
      ['^V|C$', /錨點不一致/],
      ['^(ab)+', /不支援/],
      ['^a++', /巢狀量詞/],
      ['^[ab', /沒有對應/],
      ['^[]', /至少要有一個字母/],
      ['^a\\1', /不支援/],
      ['^.', /不支援/],
      ['^', /是空的/],
      ['', /非空字串/],
    ]) {
      expect(() => compileCondition(/** @type {string} */ (source), opts), String(source)).toThrow(message)
    }
  })

  it('病態的長條件仍在有界的工作量內編譯完成（狀態數有上限）', () => {
    const cond = compileCondition(`^${'V?'.repeat(40)}C`, opts)
    expect(cond.size).toBeLessThanOrEqual(256)
    expect(cond.test('aab')).toBe(true)
    expect(() => compileCondition(`^${'a'.repeat(300)}`, opts)).toThrow(/太長/)
  })
})
