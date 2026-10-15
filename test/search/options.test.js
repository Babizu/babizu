/**
 * 搜尋引擎的選項來自介面（網址參數等），維持寬容：不認得的值回退到預設值，而不是丟出錯誤讓頁面壞掉。
 * （演算法的公開 API 收到錯誤的參數則清楚地丟出，見 BCDP 套件的 packages/bcdp/test/guards.test.js。）
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.ts'
import { buildSearchIndex, SearchEngine } from '../../src/search/index.ts'
import { PAZEH_PROFILE } from '../../packages/bcdp/test/fixtures/pazeh.js'

describe('搜尋引擎：選項來自介面，不認得的值回退到預設值', () => {
  const records = ['daux', 'kita', 'mudaux'].map((text, k) =>
    createRecord({ source: 'dict', localId: `r${k}`, unit: 'word', text, citation: createCitation('dict') }, { senses: [createSense({ zh: text })] }),
  )
  const built = JSON.parse(JSON.stringify(buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: PAZEH_PROFILE })))
  const engine = new SearchEngine(built)
  const strip = (/** @type {any} */ r) => ({ ...r, stats: { ...r.stats, elapsedMs: 0 } })

  it('不認得的模糊程度當作 normal', () => {
    expect(strip(engine.search('dox', { fuzziness: /** @type {any} */ ('nonsense') }))).toEqual(strip(engine.search('dox', { fuzziness: 'normal' })))
  })

  it('查詢不是字串時轉成字串（null、undefined 是空查詢）', () => {
    expect(engine.search(/** @type {any} */ (null)).query).toBe('')
    expect(engine.search(/** @type {any} */ (undefined)).query).toBe('')
  })

  it('不認得的欄位、排除方法不影響其他部分', () => {
    expect(strip(engine.search('dox', { fields: /** @type {any} */ (['native', 'nonsense']) }))).toEqual(strip(engine.search('dox', { fields: ['native'] })))
    expect(strip(engine.search('dox', { exclude: /** @type {any} */ (['nonsense']) }))).toEqual(strip(engine.search('dox')))
  })
})
