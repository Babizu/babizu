/**
 * @file babizu/site：建置、預覽、檢查辭典網站。CLI（bin/babizu.js）就是呼叫這些函式。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadSiteConfig, missingMessages } from './config.js'
import { prepareSiteData } from './prepare.js'
import { createViteConfig } from './vite.js'

export { defineSite, loadSiteConfig, localize, missingMessages, varietyColors, flattenMessages } from './config.js'
export { prepareSiteData, SITE_DATA_VERSION } from './prepare.js'
export { createViteConfig, varietyCss } from './vite.js'
export { APP_DIR, BUILTIN_LOCALES, FRAMEWORK_ROOT } from './paths.js'

/**
 * 建置網站到 `<站台>/dist/`。
 * @param {string} siteDir
 * @param {{log?: (m: string) => void}} [options]
 */
export async function buildSite(siteDir, { log = console.log } = {}) {
  const site = await loadSiteConfig(siteDir)
  const { publicDir } = await prepareSiteData(site, { log })
  const { build } = await import('vite')
  await build({ ...createViteConfig(site, { publicDir }), logLevel: 'warn' })
  log(`✓ 網站建置完成 → ${join(site.root, 'dist')}`)
  return site
}

/**
 * 開發伺服器（改前端程式會即時更新；改資料或設定請重新啟動）。
 * @param {string} siteDir
 * @param {{port?: number, log?: (m: string) => void}} [options]
 */
export async function devSite(siteDir, { port, log = console.log } = {}) {
  const site = await loadSiteConfig(siteDir)
  const { publicDir } = await prepareSiteData(site, { log })
  const { createServer } = await import('vite')
  const server = await createServer({ ...createViteConfig(site, { publicDir }), server: { port } })
  await server.listen()
  server.printUrls()
  return server
}

/**
 * 預覽建置結果（端對端測試也用它）。
 * @param {string} siteDir
 * @param {{port?: number}} [options]
 */
export async function previewSite(siteDir, { port = 4173 } = {}) {
  const site = await loadSiteConfig(siteDir)
  if (!existsSync(join(site.root, 'dist', 'index.html'))) throw new Error('還沒有建置結果，請先執行 babizu build')
  const { preview } = await import('vite')
  const server = await preview({
    ...createViteConfig(site, { publicDir: join(site.root, '.babizu', 'public') }),
    preview: { port, strictPort: true },
  })
  server.printUrls()
  return server
}

/**
 * 檢查站台設定、語言設定檔與資料集，但不建置。
 * @param {string} siteDir
 * @param {{log?: (m: string) => void}} [options]
 */
export async function checkSite(siteDir, { log = console.log } = {}) {
  const site = await loadSiteConfig(siteDir)
  log(`✓ 站台設定：${site.client.id}（語系 ${site.client.locales.join('、')}；變體 ${site.client.varieties.length} 種）`)
  const { readDataset, validateDataset } = await import('../dataset.js')
  const loaded = await readDataset(site.dataDir)
  const issues = validateDataset(loaded, { dialects: site.client.varieties.map((v) => v.code) })
  const errors = issues.filter((i) => i.level === 'error')
  const records = loaded.reduce((n, l) => n + l.shards.reduce((m, s) => m + s.records.length, 0), 0)
  log(`${errors.length ? '✗' : '✓'} 資料集：${loaded.length} 個來源、${records} 筆記錄；${errors.length} 個錯誤、${issues.length - errors.length} 個警告`)
  for (const e of errors.slice(0, 20)) log(`  ${e.source}：${e.message}`)
  for (const [locale, keys] of Object.entries(missingMessages(site))) {
    if (keys.length) log(`· 語系 ${locale} 缺 ${keys.length} 個介面字串（顯示時回退到 ${site.client.defaultLocale}）`)
  }
  return errors.length === 0
}
