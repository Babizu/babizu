/**
 * 站台設定（src/site/config.js）：搜尋選項 search.morphology（開放給讀者選擇的構詞搜尋實作與預設值）。
 * 每個案例在暫存目錄建一個最小的站台（babizu.config.js ＋ language.json）。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadSiteConfig } from '../../src/site/config.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

const dirs = /** @type {string[]} */ ([])
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/**
 * @param {Record<string, unknown>} extra 站台設定的其他欄位
 * @param {boolean} [morphology] 語言設定檔有沒有 morphology
 */
function site(extra, morphology = true) {
  const dir = mkdtempSync(join(tmpdir(), 'babizu-site-'))
  dirs.push(dir)
  const profile = morphology ? { ...PAZEH_PROFILE, morphology: { prefixes: [{ form: 'mu' }] } } : PAZEH_PROFILE
  writeFileSync(join(dir, 'language.json'), JSON.stringify(profile))
  writeFileSync(join(dir, 'babizu.config.js'), `export default ${JSON.stringify({ id: 'test-site', title: '測試', ...extra })}\n`)
  return loadSiteConfig(dir)
}

describe('站台設定：search.morphology', () => {
  it('沒有設定時只開放 BCDP', async () => {
    expect((await site({})).client.search.morphology).toEqual({ methods: ['bcdp'], default: 'bcdp' })
  })

  it('開放兩種、預設類 pika 剖析器；沒寫 default 時是清單的第一個', async () => {
    expect((await site({ search: { morphology: { methods: ['bcdp', 'chart'], default: 'chart' } } })).client.search.morphology).toEqual({ methods: ['bcdp', 'chart'], default: 'chart' })
    expect((await site({ search: { morphology: { methods: ['chart', 'bcdp'] } } })).client.search.morphology.default).toBe('chart')
  })

  it('錯誤的設定有具體的訊息', async () => {
    await expect(site({ search: { morphology: { methods: ['pika'] } } })).rejects.toThrow(/methods 必須是非空陣列，每一項是 bcdp、chart 之一/)
    await expect(site({ search: { morphology: { methods: [] } } })).rejects.toThrow(/methods 必須是非空陣列/)
    await expect(site({ search: { morphology: { methods: ['bcdp', 'bcdp'] } } })).rejects.toThrow(/重複/)
    await expect(site({ search: { morphology: { methods: ['bcdp'], default: 'chart' } } })).rejects.toThrow(/default「chart」不在 methods 中/)
    await expect(site({ search: { morphology: { methods: ['bcdp', 'chart'] } } }, false)).rejects.toThrow(/只能在語言設定檔有 morphology 時設定/)
  })
})
