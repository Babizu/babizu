/**
 * Vite 設定：框架以套件安裝（在 node_modules/babizu 裡）時，開發伺服器也要能正確載入前端。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSiteConfig } from '../../src/site/config.js'
import { FRAMEWORK_ROOT } from '../../src/site/paths.js'
import { createViteConfig, FRONTEND_DEPS } from '../../src/site/vite.js'

const site = await loadSiteConfig(join(FRAMEWORK_ROOT, 'examples/minimal'))
const vueDir = dirname(createRequire(join(FRAMEWORK_ROOT, 'package.json')).resolve('vue/package.json'))

describe('createViteConfig', () => {
  it('前端的套件明列預先打包，並且只有一份（否則 reka-ui 以原始檔載入，對話框的 provide／inject 對不上）', () => {
    const config = createViteConfig(site, { publicDir: 'public' })
    expect(config.optimizeDeps?.include).toEqual(expect.arrayContaining(['vue', 'vue-router', 'reka-ui', '@lucide/vue']))
    expect(config.resolve?.dedupe).toEqual(expect.arrayContaining(['vue', 'reka-ui']))
    // 自動探索關掉：以 @ 開頭的別名（@/…）在 node_modules 裡會被誤當成套件另外打包一份
    expect(config.optimizeDeps?.noDiscovery).toBe(true)
  })

  it('前端引用的每個套件都在預先打包的清單裡（自動探索關掉了，漏列的套件在開發伺服器上會載入失敗）', () => {
    /** @param {string} dir @returns {string[]} */
    const files = (dir) =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? files(path) : /\.(js|vue)$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
      })
    const packages = new Set()
    for (const file of files(join(FRAMEWORK_ROOT, 'app/src'))) {
      for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '([^'.\/][^']*)'/g)) {
        if (spec.startsWith('@/') || spec.startsWith('@babizu/') || spec.startsWith('virtual:')) continue
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
      }
    }
    expect([...packages].filter((p) => !FRONTEND_DEPS.includes(p))).toEqual([])
  })

  it('開發伺服器可以讀取框架依賴實際安裝的目錄（字型檔等），指定埠號也不會丟掉這個設定', () => {
    const config = createViteConfig(site, { publicDir: 'public', port: 5555 })
    const allow = /** @type {string[]} */ (config.server?.fs?.allow)
    expect(config.server?.port).toBe(5555)
    expect(allow).toContain(site.root)
    expect(allow.some((dir) => vueDir.startsWith(dir))).toBe(true)
  })
})
