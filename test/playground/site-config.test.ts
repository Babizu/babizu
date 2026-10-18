/**
 * 展示版的站台設定（`playground: { sample }`）：讀範例專案、語言設定檔用範例的；建置時只放範例專案，不讀資料集。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadSiteConfig } from '../../src/site/config.ts'
import { prepareSiteData } from '../../src/site/prepare.ts'

const EXAMPLE = new URL('../../examples/playground/', import.meta.url)
const SAMPLE = JSON.parse(readFileSync(new URL('sample-project.json', EXAMPLE), 'utf8'))

// 在暫存目錄建置（不在框架目錄下留產物）。不用 fs.cpSync：Node 22 在 Windows、路徑含非 ASCII 字元時會當掉
const dir = mkdtempSync(join(tmpdir(), 'babizu-playground-site-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
mkdirSync(join(dir, 'content'))
for (const name of ['sample-project.json', 'content/about.zh-TW.md', 'content/about.en.md']) writeFileSync(join(dir, name), readFileSync(new URL(name, EXAMPLE)))
// 暫存目錄裡找不到 babizu 套件：站台設定去掉 defineSite（它只是回傳原物件）
const config = readFileSync(new URL('babizu.config.js', EXAMPLE), 'utf8').replace(/^import \{ defineSite \} from 'babizu'\n/mu, '').replace('export default defineSite(', 'export default (')
writeFileSync(join(dir, 'babizu.config.js'), config)

describe('展示版的站台設定', () => {
  it('範例專案通過檢查；語言設定檔用範例的；送進瀏覽器的設定標明 playground', async () => {
    const site = await loadSiteConfig(dir)
    expect(site.playgroundSample?.words.length).toBe(SAMPLE.words.length)
    expect(site.client.playground).toBe(true)
    expect(site.client.profile).toEqual(SAMPLE.profile)
  })

  it('建置時只放範例專案（playground/sample.json），不讀資料集', async () => {
    const site = await loadSiteConfig(dir)
    const logs: string[] = []
    await prepareSiteData(site, { log: (m) => logs.push(m) })
    const out = join(dir, '.babizu', 'public')
    expect(JSON.parse(readFileSync(join(out, 'playground', 'sample.json'), 'utf8'))).toEqual(SAMPLE)
    expect(existsSync(join(out, 'data', 'manifest.json'))).toBe(false)
    expect(logs[0]).toContain('展示版')
  })

  it('範例專案有誤、或同時設定對應組檢索：列出錯誤', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'babizu-playground-bad-'))
    try {
      writeFileSync(join(bad, 'sample.json'), JSON.stringify({ ...SAMPLE, words: [{ ...SAMPLE.words[0], dialects: ['west'] }] }))
      writeFileSync(join(bad, 'babizu.config.js'), "export default { id: 'x', title: 'x', playground: { sample: 'sample.json' }, csr: { model: 'm.json' } }\n")
      await expect(loadSiteConfig(bad)).rejects.toThrow(/展示版的範例專案：words\[0\]\.dialects[\s\S]*展示版不提供對應組檢索/u)
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })
})
