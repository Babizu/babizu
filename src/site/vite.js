/**
 * @file 以 Vite 建置網站：框架的前端原始碼（app/）＋站台設定＋準備好的資料。
 *
 * 站台設定以虛擬模組 `virtual:babizu/site` 注入前端；網站名稱、語系、站徽、方言顏色等
 * 需要在頁面載入前就生效的部分，直接寫進 index.html。
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { APP_DIR, FRAMEWORK_ROOT } from './paths.js'

/**
 * 前端用到的套件：開發伺服器只預先打包這些（optimizeDeps.include），並關掉自動探索（noDiscovery）。
 *
 * 框架以 GitHub 標籤安裝時，前端原始碼在 node_modules/babizu 裡，Vite 把它當成「套件裡的程式」：
 * - 它引用的套件不會自動預先打包：reka-ui 以數百個原始檔載入，與預先打包的 vue 混用，
 *   元件之間的 provide／inject 對不上（對話框、彈出選單全部失效）；
 * - 反過來，`@/…`、`@babizu/…` 這類以 @ 開頭的別名，解析到 node_modules 裡，會被當成套件另外打包一份：
 *   同一個模組兩份實體，全站共用的狀態（語系、來源清單、播放器）各自一份，改了程式也不會重新載入。
 * 所以只打包明列的套件，其他一律當原始碼。新增前端依賴時要加進這裡（test/site/vite.test.js 檢查）。
 */
export const FRONTEND_DEPS = ['vue', 'vue-router', 'reka-ui', '@lucide/vue', '@vueuse/core', 'class-variance-authority', 'clsx', 'tailwind-merge', 'vue-sonner']

/**
 * 框架的依賴實際安裝的 node_modules 目錄（以 GitHub 標籤安裝時通常被提升到站台的 node_modules，
 * 以本機連結開發時在框架自己的 node_modules）。開發伺服器要能讀到它們（例如字型檔）。
 */
function dependencyDir() {
  try {
    const vuePackage = createRequire(join(FRAMEWORK_ROOT, 'package.json')).resolve('vue/package.json')
    return dirname(dirname(vuePackage))
  } catch {
    return join(FRAMEWORK_ROOT, 'node_modules')
  }
}

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
 * @param {{publicDir: string, port?: number}} options port：開發伺服器的埠號（其他 server 設定不變）
 * @returns {import('vite').InlineConfig}
 */
export function createViteConfig(site, { publicDir, port }) {
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
      // 同一個套件只能有一份（Vue 的 provide／inject、reka-ui 的元件 context 都靠模組實體相同）
      dedupe: ['vue', 'vue-router', 'reka-ui'],
    },
    optimizeDeps: { include: FRONTEND_DEPS, noDiscovery: true },
    worker: { format: 'es' },
    build: {
      outDir: join(site.root, 'dist'),
      emptyOutDir: true,
      target: 'es2022',
      chunkSizeWarningLimit: 800,
    },
    server: { ...(port ? { port } : {}), fs: { allow: [FRAMEWORK_ROOT, site.root, dependencyDir()] } },
    preview: { port: 4173, strictPort: true },
  }
}
