/**
 * 句型搜尋（示範站台）：自動判斷、結果的三個分頁與記錄的分區、語法錯誤、強制模式、關於頁的說明；
 * 以及結果列的文字可以拖曳反白（v-card-link，一般搜尋的列也一樣）。
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
  await page.getByRole('tab', { name: /^記錄/ }).click()
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

test('記錄依語言單位分區：sapi 有詞條也有句子；分區標籤可以只看一區', async ({ page }) => {
  await page.goto('./#/?q=sapi&m=pattern')
  await expect(page.getByRole('heading', { name: /^詞條/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: /^句子/ })).toBeVisible()
  await page.getByRole('button', { name: /^句子/ }).click()
  await expect(page.getByRole('heading', { name: /^詞條/ })).toHaveCount(0)
  await expect(page.locator('article').filter({ hasText: 'sapi ka alim' })).toBeVisible()
  await page.getByRole('button', { name: /^全部/ }).click()
  await expect(page.getByRole('heading', { name: /^詞條/ })).toBeVisible()
})

/**
 * 在元素上由左到右拖曳滑鼠
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} target
 */
async function dragAcross(page, target) {
  const box = /** @type {{x: number, y: number, width: number, height: number}} */ (await target.boundingBox())
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('結果的文字可以拖曳反白（不是拖出網址、也不開啟記錄）；沒有反白時點整列仍開啟記錄', async ({ page }) => {
  await page.goto('./#/?q=_%20ka%20_')
  const row = page.locator('article').filter({ hasText: 'sapi ka alim' })
  await expect(row).toBeVisible({ timeout: 30_000 })
  const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? '')
  // 釋義與句子本身（句子是連結）都可以反白
  for (const target of [row.locator('.gloss-zh'), row.getByRole('link').first()]) {
    await dragAcross(page, target)
    expect((await selected()).length).toBeGreaterThan(2)
    await expect(page).toHaveURL(/q=_/)
  }
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await row.locator('.gloss-zh').click()
  await expect(page).toHaveURL(/#\/r\//)
})

test('一般搜尋的詞條列也可以反白', async ({ page }) => {
  await page.goto('./#/?q=sapi')
  const gloss = page.locator('article .gloss-zh').first()
  await expect(gloss).toBeVisible({ timeout: 30_000 })
  await dragAcross(page, gloss)
  expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).length).toBeGreaterThan(0)
  await expect(page).toHaveURL(/q=sapi/)
})
