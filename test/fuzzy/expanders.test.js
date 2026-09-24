import { describe, expect, it } from 'vitest'
import { createAffixStripper } from '../../src/fuzzy/index.js'

describe('createAffixStripper（實驗性）', () => {
  const expand = createAffixStripper({
    prefixes: ['mu', 'ma'],
    suffixes: ['an'],
    infixes: ['in'],
    cost: 0.3,
  })

  it('剝除前綴、後綴、中綴', () => {
    expect(expand('mudaux')).toEqual([{ form: 'daux', cost: 0.3, note: '去前綴 mu-' }])
    expect(expand('dauxan')).toEqual([{ form: 'daux', cost: 0.3, note: '去後綴 -an' }])
    expect(expand('kinita')).toEqual([{ form: 'kita', cost: 0.3, note: '去中綴 <in>' }])
  })

  it('詞幹太短時不剝除', () => {
    expect(expand('muan')).toEqual([])
  })
})
