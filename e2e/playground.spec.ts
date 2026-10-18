/**
 * 展示版（examples/playground；docs/playground.md）的端對端測試：在瀏覽器裡匯入詞表、改規則與構詞、建置、搜尋，
 * 專案留在瀏覽器裡，可以匯出、匯入。每個測試是新的瀏覽器環境（IndexedDB 是空的），從範例專案開始。
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/** 頁面內容寬度不得超過視窗寬度（允許 1px 誤差） */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(scrollWidth, '頁面出現水平捲軸（跑版）').toBeLessThanOrEqual(innerWidth + 1)
}

/** 按「建置」並等頁面重新載入 */
async function build(page: Page) {
  // 檢查是延遲執行的：等「建置」可以按
  const button = page.getByRole('button', { name: '建置', exact: true })
  await expect(button).toBeEnabled()
  await Promise.all([page.waitForEvent('load'), button.click()])
}

/** 開工作台的某個分頁 */
async function studio(page: Page, tab: string) {
  await page.goto('./#/studio')
  await page.getByRole('tab', { name: tab }).click()
}

test('第一次開啟是範例專案：在瀏覽器裡建置之後可以跨方言搜尋', async ({ page }) => {
  await page.goto('./#/?q=ralan')
  await expect(page.locator('article').filter({ hasText: 'lalan' }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: '工作台' }).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('匯入貼上的表格（方言值對不到的自動新增為變體）→ 建置 → 搜得到新詞，篩選有新的變體；重新整理之後還在', async ({ page }) => {
  await studio(page, '詞表')
  await page.getByRole('button', { name: '匯入' }).first().click()
  await page.getByLabel('貼上表格').fill('詞\t中文\t方言\nwatu\t石頭\tnorth\nbatu\t石頭\t山區')
  await page.getByRole('button', { name: '讀取貼上的內容' }).click()
  await expect(page.getByText('會匯入 2 列')).toBeVisible()
  await expect(page.getByText('方言欄有這些值對不到語言變體：山區')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '匯入', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '詞形' }).last()).toHaveValue('batu')
  await expectNoHorizontalOverflow(page)
  await build(page)
  await page.goto('./#/?q=batu&f=native')
  await expect(page.locator('article').filter({ hasText: 'batu' }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('main').getByText('山區').first()).toBeAttached()
  await page.reload()
  await expect(page.locator('article').filter({ hasText: 'batu' }).first()).toBeVisible({ timeout: 30_000 })
})

test('新增一條方言規則 → 建置 → 模糊搜尋找到原本找不到的詞', async ({ page }) => {
  // 範例中 asu（狗）沒有對應的寫法；加一個詞 azu 與規則 s ↔ z
  await studio(page, '詞表')
  await page.getByRole('button', { name: '新增一個詞' }).click()
  await page.getByRole('textbox', { name: '詞形' }).last().fill('azu')
  await page.getByRole('tab', { name: '方言規則' }).click()
  await page.getByRole('button', { name: '新增規則組' }).click()
  await page.getByRole('textbox', { name: '寫法 A' }).last().fill('s')
  await page.getByRole('textbox', { name: '寫法 B' }).last().fill('z')
  await build(page)
  await page.goto('./#/?q=asu&f=native')
  await expect(page.locator('article').filter({ hasText: 'azu' }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /相近拼寫/ }).first()).toBeVisible()
})

test('構詞：加一個前綴 → 建置 → 實驗室的 BCDP 分頁拆出詞根', async ({ page }) => {
  await studio(page, '構詞')
  // 範例已有 ma-、pa-：新增的是前綴的第 3 列
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  await page.getByRole('textbox', { name: '寫法', exact: true }).nth(2).fill('ka')
  await build(page)
  await page.goto('./#/lab?tab=bcdp&q=kakan&t=kan')
  await expect(page.getByText('找到的詞根').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /^kan / }).first()).toBeVisible()
})

test('匯出專案檔再匯入：內容相同；檢查不通過時不能建置', async ({ page }, testInfo) => {
  await studio(page, '專案')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '匯出專案檔' }).click()])
  const file = testInfo.outputPath('project.babizu.json')
  await download.saveAs(file)
  const exported = JSON.parse(readFileSync(file, 'utf8'))
  expect(exported).toMatchObject({ format: 'babizu-playground-project', title: { 'zh-TW': '示範語（範例專案）' } })

  // 換成空白專案，再匯入剛才的檔
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '新的空白專案' }).click()
  await expect(page.locator('#title-zh-TW')).toHaveValue('新的辭典')
  page.once('dialog', (d) => d.accept())
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(page.locator('#title-zh-TW')).toHaveValue('示範語（範例專案）')

  // 詞形空白：列出問題，「建置」不能按
  await page.getByRole('tab', { name: '詞表' }).click()
  await page.getByRole('textbox', { name: '詞形' }).first().fill('')
  await expect(page.getByText(/有 1 個問題/)).toBeVisible()
  await expect(page.getByRole('button', { name: '建置', exact: true })).toBeDisabled()
})
