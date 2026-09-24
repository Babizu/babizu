/**
 * @file 以 Vite 建置網站：框架的前端原始碼（app/）＋站台設定＋準備好的資料。
 *
 * 站台設定以虛擬模組 `virtual:babizu/site` 注入前端；網站名稱、語系、站徽、方言顏色等
 * 需要在頁面載入前就生效的部分，直接寫進 index.html。
 */

import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { APP_DIR, FRAMEWORK_ROOT } from './paths.js'

const SITE_MODULE = 'virtual:babizu/site'
const RESOLVED_SITE_MODULE = `\0${SITE_MODULE}`

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/**
 * 語言變體的顏色：每個變體一個 class，淺色與深色模式各一組 CSS 變數。
 * @param {import('./config.js').ResolvedSite['client']['varieties']} varieties
 */
export function varietyCss(varieties) {
  return varieties
    .map(
      (v) =>
        `.variety-${v.code}{--variety-fg:${v.colors.light.fg};--variety-bg:${v.colors.light.bg}}` +
        `.dark .variety-${v.code}{--variety-fg:${v.colors.dark.fg};--variety-bg:${v.colors.dark.bg}}`,
    )
    .join('\n')
}

/**
 * @param {import('./config.js').ResolvedSite} site
 * @returns {import('vite').Plugin}
 */
function babizuSitePlugin(site) {
  const c = site.client
  const lang = c.defaultLocale
  return {
    name: 'babizu-site',
    resolveId(id) {
      return id === SITE_MODULE ? RESOLVED_SITE_MODULE : null
    },
    load(id) {
      return id === RESOLVED_SITE_MODULE ? `export default ${JSON.stringify(c)}` : null
    },
    // 要在 Vite 處理 HTML 之前代入：Vite 會處理內嵌的 <style>，佔位符若放在 CSS 裡會先被刪掉
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // 沒有站徽時給一個空的，免得瀏覽器自己去要 /favicon.ico 而得到 404
        const icon = c.icon
          ? `<link rel="icon" href="./${escapeHtml(c.icon)}" />\n    <link rel="apple-touch-icon" href="./${escapeHtml(c.icon)}" />`
          : '<link rel="icon" href="data:," />'
        return html
          .replaceAll('%babizu.lang%', escapeHtml(lang))
          .replaceAll('%babizu.title%', escapeHtml(c.title[lang]))
          .replaceAll('%babizu.description%', escapeHtml(c.description?.[lang] ?? ''))
          .replaceAll('%babizu.themeColor%', escapeHtml(c.themeColor))
          .replaceAll('%babizu.icon%', icon)
          .replaceAll('%babizu.storagePrefix%', escapeHtml(c.id))
          .replaceAll('<!-- %babizu.varieties% -->', `<style>\n${varietyCss(c.varieties)}\n    </style>`)
      },
    },
  }
}

/**
 * 產生 Vite 設定。
 * @param {import('./config.js').ResolvedSite} site
 * @param {{publicDir: string}} options
 * @returns {import('vite').InlineConfig}
 */
export function createViteConfig(site, { publicDir }) {
  return {
    configFile: false,
    root: APP_DIR,
    base: './',
    publicDir,
    cacheDir: join(site.root, '.babizu', 'vite'),
    plugins: [vue(), tailwindcss(), babizuSitePlugin(site)],
    resolve: {
      alias: {
        '@babizu': join(FRAMEWORK_ROOT, 'src'),
        '@': join(APP_DIR, 'src'),
      },
    },
    worker: { format: 'es' },
    build: {
      outDir: join(site.root, 'dist'),
      emptyOutDir: true,
      target: 'es2022',
      chunkSizeWarningLimit: 800,
    },
    server: { fs: { allow: [FRAMEWORK_ROOT, site.root] } },
    preview: { port: 4173, strictPort: true },
  }
}
