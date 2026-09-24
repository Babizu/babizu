/**
 * @file 框架的單元測試設定。
 *
 * - node：演算法、schema、搜尋引擎、資料管線、站台設定（test/）
 * - app：前端元件與工具（app/src/**\/*.test.js），用 jsdom；
 *   `virtual:babizu/site` 換成測試用的站台設定（test/fixtures/site-client.js）
 */

import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const here = (/** @type {string} */ path) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'node', include: ['test/**/*.test.js'], environment: 'node' },
      },
      {
        plugins: [vue()],
        resolve: {
          alias: {
            'virtual:babizu/site': here('./test/fixtures/site-client.js'),
            '@babizu': here('./src'),
            '@': here('./app/src'),
          },
        },
        test: { name: 'app', include: ['app/src/**/*.test.js'], environment: 'jsdom' },
      },
    ],
  },
})
