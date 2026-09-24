/**
 * @file 框架自己的端對端測試：建置 examples/minimal（虛構的示範語言）後，在手機與桌面尺寸下測主要流程。
 * 執行：npm run test:e2e（會先建置示範站台）
 *
 * 瀏覽器：預設使用 Playwright 內建的 Chromium（需先 `npx playwright install chromium`）；
 * 也可以用環境變數指定本機已安裝的瀏覽器，例如 `PLAYWRIGHT_CHANNEL=msedge`。
 */

import { defineConfig, devices } from '@playwright/test'

const channel = process.env.PLAYWRIGHT_CHANNEL || undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [['list']],
  webServer: {
    command: 'node bin/babizu.js preview examples/minimal --port 4180',
    port: 4180,
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:4180/', locale: 'zh-TW', channel },
  projects: [
    { name: 'narrow', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 658 }, channel } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, channel } },
  ],
})
