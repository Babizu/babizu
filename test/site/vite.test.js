/**
 * Vite 設定：框架以套件安裝（在 node_modules/babizu 裡）時，開發伺服器也要能正確載入前端。
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSiteConfig } from '../../src/site/config.js'
import { FRAMEWORK_ROOT } from '../../src/site/paths.js'
import { createViteConfig } from '../../src/site/vite.js'

const site = await loadSiteConfig(join(FRAMEWORK_ROOT, 'examples/minimal'))
const vueDir = dirname(createRequire(join(FRAMEWORK_ROOT, 'package.json')).resolve('vue/package.json'))

describe('createViteConfig', () => {
  it('前端的套件明列預先打包，並且只有一份（否則 reka-ui 以原始檔載入，對話框的 provide／inject 對不上）', () => {
    const config = createViteConfig(site, { publicDir: 'public' })
    expect(config.optimizeDeps?.include).toEqual(expect.arrayContaining(['vue', 'vue-router', 'reka-ui', '@lucide/vue']))
    expect(config.resolve?.dedupe).toEqual(expect.arrayContaining(['vue', 'reka-ui']))
  })

  it('開發伺服器可以讀取框架依賴實際安裝的目錄（字型檔等），指定埠號也不會丟掉這個設定', () => {
    const config = createViteConfig(site, { publicDir: 'public', port: 5555 })
    const allow = /** @type {string[]} */ (config.server?.fs?.allow)
    expect(config.server?.port).toBe(5555)
    expect(allow).toContain(site.root)
    expect(allow.some((dir) => vueDir.startsWith(dir))).toBe(true)
  })
})
