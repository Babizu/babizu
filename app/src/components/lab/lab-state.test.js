/**
 * 演算法實驗室的距離函式必須與搜尋一致：沒有修改時逐一相同，改了之後只差在改過的地方。
 */

import { createSearchMetric, createTextTools } from '@babizu/search/text.js'
import site from 'virtual:babizu/site'
import { describe, expect, it } from 'vitest'
import { createLabState } from './lab-state.js'

/** 取自設定檔規則的字母，加上空白與體例符號，讓隨機詞對常常碰到規則、邊界與正規化 */
const ALPHABET = ['a', 'e', 'i', 'u', 'o', 'r', 'l', 'n', 'g', 'x', 'h', 'k', 'd', 'z', 's', 't', "'", ' ', '-']

/** @param {number} seed */
function pairs(seed, count = 400) {
  let s = seed
  const rnd = (/** @type {number} */ n) => (s = (s * 16807) % 2147483647) % n
  const word = () => Array.from({ length: 1 + rnd(7) }, () => ALPHABET[rnd(ALPHABET.length)]).join('')
  return Array.from({ length: count }, () => [word(), word()])
}

describe('實驗室的距離函式', () => {
  it('沒有修改時，與搜尋引擎的距離函式逐一相同（含體例符號、詞邊界、單向規則、所有成本覆寫）', () => {
    const { metric } = createLabState()
    const search = createTextTools(site.profile).createSearchMetric()
    for (const [x, y] of pairs(7)) expect(metric.value.distance(x, y), `${x} / ${y}`).toBe(search.distance(x, y))
    // 體例符號與搜尋一樣被刪除
    expect(metric.value.distance('sikis-', 'sikis')).toBe(0)
  })

  it('關掉一個分類 ＝ 搜尋用的距離函式去掉那一類規則', () => {
    const lab = createLabState()
    const group = lab.state.groups.find((g) => g.rules.length > 1)
    if (!group) throw new Error('測試用的設定檔沒有規則')
    group.enabled = false
    const profile = { ...site.profile, rules: site.profile.rules.filter((/** @type {any} */ g) => g.category !== group.category) }
    const expected = createSearchMetric(profile)
    for (const [x, y] of pairs(11)) expect(lab.metric.value.distance(x, y), `${x} / ${y}`).toBe(expected.distance(x, y))
  })

  it('改了空白的成本，只有空白的三種操作改變；其他字元的覆寫保留', () => {
    const lab = createLabState()
    lab.state.costs.space = 0.5
    const costs = site.profile.costs ?? {}
    const expected = createSearchMetric(site.profile, {
      costs: { ...costs, overrides: { ...(costs.overrides ?? {}), ' ': { substitute: 0.5, delete: 0.5, insert: 0.5 } } },
    })
    for (const [x, y] of pairs(13)) expect(lab.metric.value.distance(x, y), `${x} / ${y}`).toBe(expected.distance(x, y))
    lab.reset()
    const search = createSearchMetric(site.profile)
    expect(lab.metric.value.distance('a b', 'ab')).toBe(search.distance('a b', 'ab'))
  })
})
