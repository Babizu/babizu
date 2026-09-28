/**
 * 排序分數（src/search/scoring.js）：詞條與例句共用的規則。
 */

import { describe, expect, it } from 'vitest'
import { compareOccurrences, DERIVATIVE_PENALTY, mergeMorphMatch, rankScore, recordScore, termScore } from '../../src/search/scoring.js'

/** @param {Partial<import('../../src/search/scoring.js').Scored>} o */
const m = (o) => /** @type {import('../../src/search/scoring.js').Scored} */ ({ term: 'x', distance: 0, matchType: 'fuzzy', ...o })

describe('詞的分數與記錄的分數', () => {
  it('命中方式換算成等效距離；已經定下的分數優先', () => {
    expect(rankScore('fuzzy', 0.1, 3)).toBe(0.1)
    expect(rankScore('prefix', 0, 2)).toBeCloseTo(0.45, 9)
    expect(rankScore('derived', 0.3, 5)).toBeCloseTo(0.7, 9)
    expect(termScore(m({ term: 'usaan', matchType: 'prefix' }), 'usa')).toBeCloseTo(0.45, 9)
    expect(termScore(m({ term: 'usaan', matchType: 'derived', distance: 0.3, score: 0.45 }), 'usa')).toBe(0.45)
  })

  it('辭典標註的派生關係每一層加上 DERIVATIVE_PENALTY', () => {
    expect(recordScore(0)).toBe(0)
    expect(recordScore(0.1, 2)).toBeCloseTo(0.1 + 2 * DERIVATIVE_PENALTY, 9)
  })
})

describe('同一個詞的構詞命中與原本的命中（mergeMorphMatch）', () => {
  it('開頭相符、包含的詞能自動派生時改以構詞命中呈現，分數取兩者較好的', () => {
    const prefix = m({ term: 'usaan', matchType: 'prefix' }) // 0.45
    const derived = m({ term: 'usaan', matchType: 'derived', distance: 0.3 }) // 0.7
    const kept = mergeMorphMatch(derived, prefix, 'usa')
    expect(kept.matchType).toBe('derived')
    expect(kept.score).toBeCloseTo(0.45, 9)
    const cheap = m({ term: 'musa', matchType: 'derived', distance: 0.2 }) // 0.6，比包含（0.95）好
    expect(mergeMorphMatch(cheap, m({ term: 'musa', matchType: 'substring' }), 'usa').score).toBeCloseTo(0.6, 9)
  })

  it('與模糊命中之間取分數較好的；同分時模糊命中優先', () => {
    const fuzzy = m({ term: 'razem', distance: 1.2 })
    const lemma = m({ term: 'razem', matchType: 'lemma', distance: 0.2 })
    expect(mergeMorphMatch(lemma, fuzzy, 'parazem')).toBe(lemma)
    const near = m({ term: 'dauxi', distance: 0.6 })
    expect(mergeMorphMatch(m({ term: 'dauxi', matchType: 'derived', distance: 0.2 }), near, 'daux')).toBe(near)
  })

  it('沒有原本的命中時直接收下', () => {
    const lemma = m({ matchType: 'lemma' })
    expect(mergeMorphMatch(lemma, undefined, 'x')).toBe(lemma)
  })
})

describe('例句的排序', () => {
  it('分數，再依最弱的命中方式、距離、句長', () => {
    const doc = (/** @type {string} */ text, /** @type {number} */ index) => ({ text, index })
    const list = [
      { score: 0.1, matchType: /** @type {const} */ ('derived'), distance: 0, doc: doc('b', 1) },
      { score: 0.1, matchType: /** @type {const} */ ('fuzzy'), distance: 0.1, doc: doc('aaa', 2) },
      { score: 0, matchType: /** @type {const} */ ('fuzzy'), distance: 0, doc: doc('long sentence', 3) },
    ]
    expect(list.sort(compareOccurrences).map((o) => o.doc.index)).toEqual([3, 2, 1])
  })
})
