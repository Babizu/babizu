/**
 * 示範站台（examples/minimal）的端對端測試：框架的每個主要功能都要能用站台設定驅動，
 * 不能依賴任何特定語言。
 */

import { expect, test } from '@playwright/test'

/** 頁面內容寬度不得超過視窗寬度（允許 1px 誤差） @param {import('@playwright/test').Page} page */
async function expectNoHorizontalOverflow(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth, '頁面出現水平捲軸（跑版）').toBeLessThanOrEqual(innerWidth + 1)
}

test('首頁：站台名稱、範例查詢與載入狀態', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1, name: 'Babizu 示範辭典' })).toBeVisible()
  await expect(page.getByText(/已載入 [\d,]+ 筆記錄/)).toBeVisible()
  await page.getByRole('list').getByRole('button').first().click()
  await expect(page).toHaveURL(/q=ralan/)
  await expectNoHorizontalOverflow(page)
})

test('跨方言模糊搜尋：語言設定檔的規則 r↔l 生效', async ({ page }) => {
  await page.goto('./#/?q=ralan')
  await expect(page.locator('article').filter({ hasText: 'lalan' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /相近拼寫/ }).first()).toBeVisible()
})

test('釋義搜尋：中文與英文', async ({ page }) => {
  await page.goto('./#/?q=火')
  await expect(page.locator('article').filter({ hasText: 'sapi' }).first()).toBeVisible()
  await page.goto('./#/?q=water')
  await expect(page.locator('article').filter({ hasText: 'tamo' }).first()).toBeVisible()
})

test('語言變體：下層變體（海岸）在篩選上層（南部）時一併出現', async ({ page }) => {
  await page.goto('./#/?q=alim&dia=south&f=native')
  await expect(page.locator('article').filter({ hasText: 'alim' }).first()).toBeVisible()
  await page.goto('./#/?q=alim&dia=north&f=native')
  // 等搜尋完成（結果數或「找不到」都會提到查詢字串）再確認海岸腔的詞不在北部的結果裡
  await expect(page.getByText(/「alim」/).first()).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'alim' })).toHaveCount(0)
})

test('關於頁：站台 Markdown 與變體徽章', async ({ page }) => {
  await page.goto('./#/about')
  await expect(page.getByRole('heading', { name: '方言對應' })).toBeVisible()
  const badge = page.locator('.site-content .variety-badge.variety-coast')
  await expect(badge).toBeVisible()
  // 徽章顏色由站台設定的色相產生，不是預設的灰色
  const color = await badge.evaluate((el) => getComputedStyle(el).color)
  expect(color).not.toBe(await page.locator('body').evaluate((el) => getComputedStyle(el).color))
  await expectNoHorizontalOverflow(page)
})

test('介面語系：切換成英文並記住', async ({ page }) => {
  await page.goto('./#/about')
  await page.getByRole('combobox', { name: '介面語言' }).selectOption('en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Correspondences' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'About this dictionary' })).toBeVisible()
})

test('演算法實驗室：預設詞對來自站台設定', async ({ page }) => {
  await page.goto('./#/lab')
  await expect(page.getByRole('textbox').first()).toHaveValue('ralan')
  await expectNoHorizontalOverflow(page)
})

test('詞條頁與資料來源', async ({ page }) => {
  await page.goto('./#/r/demo-wordlist/w1')
  await expect(page.getByRole('heading', { level: 1, name: 'ralan' })).toBeVisible()
  await expect(page.getByText('示範詞表 w1').first()).toBeVisible()
  await page.goto('./#/sources')
  await expect(page.getByText('示範詞表').first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
