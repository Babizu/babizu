/**
 * 句型搜尋（示範站台）：自動判斷、結果的三個分頁、語法錯誤、強制模式、關於頁的說明。
 * 示範語言沒有構詞規格，只測詞序；構詞樣式由網站 repo（pazeh-kaxabu）的端對端測試涵蓋。
 */

import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page */
async function expectNoHorizontalOverflow(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(scrollWidth, '頁面出現水平捲軸（跑版）').toBeLessThanOrEqual(innerWidth + 1)
}

test('_ ka _：自動改用句型搜尋，命中的詞依位置高亮；對照與頻率分頁', async ({ page }) => {
  await page.goto('./#/?q=_%20ka%20_')
  await expect(page.getByText('以句型搜尋')).toBeVisible({ timeout: 30_000 })
  const row = page.locator('article').filter({ hasText: 'sapi ka alim' })
  await expect(row).toBeVisible()
  await expect(row.locator('mark')).toHaveText(['sapi', 'ka', 'alim'])
  await expect(page.locator('article').filter({ hasText: 'bunang ka lalan' })).toBeVisible()
  // 對照：命中的部分置中，可以依右邊的詞排序（記在網址）
  await page.getByRole('tab', { name: /^對照/ }).click()
  await expect(page).toHaveURL(/tab=kwic/)
  await page.getByRole('button', { name: '右邊的詞' }).click()
  await expect(page).toHaveURL(/ks=right/)
  await expect(page.locator('ol mark').first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
  // 頻率：ka 那一格只有一種詞形，列在上面一行；點第一格的詞形篩選
  await page.getByRole('tab', { name: /^頻率/ }).click()
  await expect(page.getByText('都是')).toBeVisible()
  await page.getByRole('button', { name: /^sapi/ }).click()
  await page.getByRole('tab', { name: /^句子/ }).click()
  await expect(page.locator('article')).toHaveCount(1)
  await page.getByRole('button', { name: '取消篩選' }).click()
  await expect(page.locator('article')).toHaveCount(2)
})

test('語法錯誤：標出位置與說明；改用一般搜尋（m=plain），也能切回句型搜尋', async ({ page }) => {
  await page.goto('./#/?q=(ka%20_')
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 30_000 })
  await expect(alert).toContainText('括號沒有結束')
  await alert.getByRole('button', { name: '改用一般搜尋' }).click()
  await expect(page).toHaveURL(/m=plain/)
  await expect(page.getByText('這個查詢含有句型的寫法，目前以一般搜尋。')).toBeVisible()
  await page.getByRole('button', { name: '改用句型搜尋' }).click()
  await expect(page).not.toHaveURL(/m=plain/)
  await expect(page.getByRole('alert')).toBeVisible()
})

test('一般的查詢照舊：句末的驚嘆號、連字號不會改用句型搜尋', async ({ page }) => {
  await page.goto('./#/?q=bunang%20ka%20lalan!')
  await expect(page.locator('article').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('以句型搜尋')).toHaveCount(0)
})

test('關於頁：句型搜尋的寫法與例子（沒有構詞規格時不列構詞樣式）；例子可以直接搜尋', async ({ page }) => {
  await page.goto('./#/about#pattern')
  const section = page.locator('#pattern')
  await expect(section.getByRole('heading', { name: '句型搜尋' })).toBeVisible()
  await expect(section.getByRole('cell', { name: '任一個詞' })).toBeVisible()
  await expect(section.getByText('詞綴-詞根')).toHaveCount(0)
  await section.getByRole('link', { name: /\^ sapi/ }).click()
  await expect(page).toHaveURL(/m=pattern/)
  await expect(page.locator('article').filter({ hasText: 'sapi ka alim' })).toBeVisible({ timeout: 30_000 })
})
