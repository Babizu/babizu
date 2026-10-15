/**
 * @file 框架的單元測試設定。
 *
 * - node：BCDP 套件（packages/bcdp/test/）、schema、搜尋引擎、資料管線、站台設定（test/）
 * - app：前端元件與工具（app/src/**\/*.test.js），用 jsdom；
 *   `virtual:babizu/site` 換成測試用的站台設定（test/fixtures/site-client.js）
 *
 * 測試跑的是 BCDP 套件的 TypeScript 原始碼（`babizu-source` 條件），不需要先建置 dist：
 * Vite 解析 `#bcdp` 時用這個條件，測試的執行程序（以及它開的 worker_threads）也以
 * `--conditions=babizu-source` 啟動，由 Node 直接執行的模組也解析到原始碼。
 */

import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defaultClientConditions, defaultServerConditions } from 'vite'
import { defineConfig } from 'vitest/config'

const here = (/** @type {string} */ path) => fileURLToPath(new URL(path, import.meta.url))
const SOURCE = 'babizu-source'
const execArgv = [`--conditions=${SOURCE}`]

export default defineConfig({
  test: {
    projects: [
      {
        // golden 測試也比對實驗室的步驟（app/src/lab/steps.js），所以 node 端也要有 app 的別名
        resolve: { alias: { '@babizu': here('./src'), '@': here('./app/src') }, conditions: [SOURCE, ...defaultServerConditions] },
        ssr: { resolve: { conditions: [SOURCE, ...defaultServerConditions] } },
        test: { name: 'node', include: ['test/**/*.test.js', 'packages/bcdp/test/**/*.test.js'], environment: 'node', execArgv },
      },
      {
        plugins: [vue()],
        resolve: {
          alias: {
            'virtual:babizu/site': here('./test/fixtures/site-client.js'),
            '@babizu': here('./src'),
            '@': here('./app/src'),
          },
          conditions: [SOURCE, ...defaultClientConditions],
        },
        test: { name: 'app', include: ['app/src/**/*.test.js'], environment: 'jsdom', execArgv },
      },
    ],
  },
})
