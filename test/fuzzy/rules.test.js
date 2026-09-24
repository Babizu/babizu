import { describe, expect, it } from 'vitest'
import { RuleSet } from '../../src/fuzzy/index.js'
import { createPazehKaxabuRules, PAZEH_KAXABU_RULES } from '../fixtures/pazeh.js'

describe('RuleSet', () => {
  it('fromTable 接受陣列列與物件列', () => {
    const rules = RuleSet.fromTable([
      ['a', 'b', 0.1],
      { source: 'c', target: '', weight: 0.2, position: 'final', category: 'X' },
    ])
    const expanded = rules.expand()
    expect(expanded).toHaveLength(4) // 兩條 × 正反向
    expect(expanded.find((r) => r.source === '' && r.target === 'c')).toMatchObject({
      position: 'final',
      reversed: true,
      category: 'X',
    })
  })

  it('同一 (位置, source, target) 保留最小權重', () => {
    const rules = new RuleSet().add('a', 'b', 0.5).add('b', 'a', 0.2)
    const ab = rules.expand().filter((r) => r.source === 'a' && r.target === 'b')
    expect(ab).toHaveLength(1)
    expect(ab[0].weight).toBe(0.2)
  })

  it('可依分類停用與啟用', () => {
    const rules = createPazehKaxabuRules()
    const total = rules.expand().length
    rules.disable('閃音')
    expect(rules.expand().some((r) => r.category === '閃音')).toBe(false)
    expect(rules.expand().length).toBeLessThan(total)
    rules.enable('閃音')
    expect(rules.expand().length).toBe(total)
  })

  it('拒絕不合法的規則', () => {
    expect(() => new RuleSet().add('', '', 0.1)).toThrow(RangeError)
    expect(() => new RuleSet().add('a', 'b', -0.1)).toThrow(RangeError)
    expect(() => new RuleSet().add('a', 'b', 0.1, { position: 'middle' })).toThrow(RangeError)
  })

  it('套用正規化，正規化後相同的規則被捨棄', () => {
    const rules = new RuleSet().add('A', 'a', 0.1).add('B', 'c', 0.1)
    const expanded = rules.expand((s) => s.toLowerCase())
    expect(expanded.map((r) => `${r.source}>${r.target}`).sort()).toEqual(['b>c', 'c>b'])
  })

  it('預設規則表涵蓋需求文件的全部分類與條目', () => {
    const categories = PAZEH_KAXABU_RULES.map((g) => g.category)
    expect(categories).toEqual([
      '元音',
      '閃音',
      '靠後輔音',
      '前後鼻音',
      '靠前輔音',
      '濁化',
      '滑音產生',
      '書寫特異',
      '元音增生',
      '詞尾',
      '特例',
    ])
    const ruleCount = PAZEH_KAXABU_RULES.reduce((s, g) => s + g.rules.length, 0)
    expect(ruleCount).toBe(57)
  })

  it('clone 保留定義與開關狀態；toJSON 標示啟用與否', () => {
    const rules = createPazehKaxabuRules().disable('特例')
    const copy = rules.clone()
    expect(copy.expand()).toEqual(rules.expand())
    const disabled = rules.toJSON().filter((d) => !d.enabled)
    expect(disabled.length).toBe(2)
    expect(disabled.every((d) => d.category === '特例')).toBe(true)
  })
})
