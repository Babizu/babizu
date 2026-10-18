/**
 * @file 框架自己的端對端測試，在手機與桌面尺寸下測主要流程：
 * - examples/minimal（虛構的示範語言）：e2e/demo.spec.ts、pattern.spec.ts；
 * - examples/playground（展示版：在瀏覽器裡編輯、建置）：e2e/playground.spec.ts。
 * 執行：npm run test:e2e（會先建置兩個站台）
 *
 * 瀏覽器：預設使用 Playwright 內建的 Chromium（需先 `npx playwright install chromium`）；
 * 也可以用環境變數指定本機已安裝的瀏覽器，例如 `PLAYWRIGHT_CHANNEL=msedge`。
 */

import { defineConfig, devices } from '@playwright/test'

const channel = process.env.PLAYWRIGHT_CHANNEL || undefined
const DEMO = 'http://localhost:4180/'
const PLAYGROUND = 'http://localhost:4181/'
const narrow = { ...devices['Pixel 7'], viewport: { width: 320, height: 658 }, channel }
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, channel }

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [['list']],
  webServer: [
    { command: 'node --conditions=babizu-source bin/babizu.js preview examples/minimal --port 4180', port: 4180, reuseExistingServer: !process.env.CI },
    { command: 'node --conditions=babizu-source bin/babizu.js preview examples/playground --port 4181', port: 4181, reuseExistingServer: !process.env.CI },
  ],
  use: { locale: 'zh-TW', channel },
  projects: [
    { name: 'narrow', testIgnore: /playground\.spec/, use: { ...narrow, baseURL: DEMO } },
    { name: 'desktop', testIgnore: /playground\.spec/, use: { ...desktop, baseURL: DEMO } },
    { name: 'playground-narrow', testMatch: /playground\.spec/, use: { ...narrow, baseURL: PLAYGROUND } },
    { name: 'playground-desktop', testMatch: /playground\.spec/, use: { ...desktop, baseURL: PLAYGROUND } },
  ],
})
