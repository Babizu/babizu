/**
 * 展示版（examples/playground；docs/playground.md）的端對端測試：在瀏覽器裡匯入詞表、改規則與構詞、建置、搜尋，
 * 專案留在瀏覽器裡，可以匯出、匯入。每個測試是新的瀏覽器環境（IndexedDB 是空的），從範例專案開始。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { workbook } from '../test/playground/xlsx-fixture.ts'

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
  // 巴宰語 turu「三」，噶哈巫語 tu'u（r → '）
  await page.goto('./#/?q=turu')
  await expect(page.locator('article').filter({ hasText: "tu'u" }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: '工作台' }).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('匯入貼上的表格（方言值對不到的自動新增為變體）→ 建置 → 搜得到新詞，篩選有新的變體；重新整理之後還在', async ({ page }) => {
  await studio(page, '詞表')
  await page.getByRole('button', { name: '匯入詞表' }).click()
  await page.getByLabel('貼上表格').fill('詞\t中文\t方言\nwatu\t石頭\tpazeh\nbatu\t石頭\t山區')
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
  // 範例沒有清濁的規則（最早的規則列表的「濁化」）：加一個詞 azu 與規則 s ↔ z，查 asu
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
  // 範例已有 9 個前綴：新增的是前綴的第 10 列。maa-（相互）不在範例中
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  await page.getByRole('textbox', { name: '寫法', exact: true }).nth(9).fill('maa')
  await build(page)
  await page.goto('./#/lab?tab=bcdp&q=maabaket&t=baket')
  await expect(page.getByText('找到的詞根').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /^baket / }).first()).toBeVisible()
})

test('匯出專案檔再匯入成另一個專案：內容相同；可以切換回原本的專案；檢查不通過時不能建置', async ({ page }, testInfo) => {
  await studio(page, '專案')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '匯出專案檔' }).click()])
  const file = testInfo.outputPath('project.babizu.json')
  await download.saveAs(file)
  const exported = JSON.parse(readFileSync(file, 'utf8'))
  expect(exported).toMatchObject({ format: 'babizu-playground-project', title: { 'zh-TW': '巴宰語與噶哈巫語（範例專案）' } })

  // 新的空白專案：重新載入，目前的專案換成它，範例專案還在清單上
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: '新的空白專案' }).click()])
  await expect(page.locator('#title-zh-TW')).toHaveValue('新的辭典')
  await expect(page.getByLabel('目前的專案').locator('option')).toHaveCount(2)

  // 匯入剛才的檔：成為第三個專案
  await Promise.all([page.waitForEvent('load'), page.locator('input[type=file][accept^=".json"]').setInputFiles(file)])
  await expect(page.locator('#title-zh-TW')).toHaveValue('巴宰語與噶哈巫語（範例專案）')
  await expect(page.getByText('已匯入「project.babizu.json」')).toBeVisible()
  await expect(page.getByLabel('目前的專案').locator('option')).toHaveCount(3)

  // 切換回空白專案：沒有變更，不必確認
  const blank = page.getByLabel('目前的專案').locator('option', { hasText: '新的辭典' })
  await Promise.all([page.waitForEvent('load'), page.getByLabel('目前的專案').selectOption({ label: (await blank.textContent())?.trim() ?? '' })])
  await expect(page.locator('#title-zh-TW')).toHaveValue('新的辭典')

  // 詞形空白：列出問題，「建置」不能按；「前往」跳到那一列
  await page.getByRole('tab', { name: '詞表' }).click()
  await page.getByRole('button', { name: '新增一個詞' }).click()
  await expect(page.getByText(/有 1 個問題/)).toBeVisible()
  await expect(page.getByRole('button', { name: '建置', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: /專案/ }).click()
  await page.getByRole('button', { name: '前往' }).first().click()
  await expect(page.getByRole('textbox', { name: '詞形' }).first()).toBeFocused()
})

test('切換專案：有還沒建置的變更時先確認，草稿留在原本的專案裡', async ({ page }) => {
  await studio(page, '專案')
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: '新的空白專案' }).click()])
  await page.locator('#title-zh-TW').fill('我的詞表')
  await expect(page.getByText('有還沒建置的變更')).toBeVisible()
  await expect(page.getByText('草稿已儲存')).toBeVisible()

  // 換到範例專案：確認視窗（不是瀏覽器的 confirm）
  const select = page.getByLabel('目前的專案')
  const sampleLabel = (await select.locator('option', { hasText: '範例專案' }).textContent())?.trim() ?? ''
  await select.selectOption({ label: sampleLabel })
  const dialog = page.getByRole('dialog', { name: '切換專案' })
  await expect(dialog).toContainText('草稿會保留在這個專案裡')
  await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: '切換' }).click()])
  await expect(page.locator('#title-zh-TW')).toHaveValue('巴宰語與噶哈巫語（範例專案）')

  // 換回來：草稿還在
  const mine = (await select.locator('option', { hasText: '我的詞表' }).textContent())?.trim() ?? ''
  await Promise.all([page.waitForEvent('load'), select.selectOption({ label: mine })])
  await expect(page.locator('#title-zh-TW')).toHaveValue('我的詞表')
})

test('有還沒建置的變更時，重新整理要先經過瀏覽器的確認', async ({ page }) => {
  await studio(page, '專案')
  await page.locator('#title-zh-TW').fill('改了名稱')
  await expect(page.getByText('草稿已儲存')).toBeVisible()
  const dialogs: string[] = []
  page.on('dialog', async (d) => {
    dialogs.push(d.type())
    await d.dismiss()
  })
  // 瀏覽器只在使用者和頁面互動過之後才顯示離開確認
  await page.locator('#title-zh-TW').click()
  await page.reload({ timeout: 2000 }).catch(() => {})
  expect(dialogs).toContain('beforeunload')
  await expect(page.locator('#title-zh-TW')).toHaveValue('改了名稱')
})

test('匯入 CSV 檔：Windows 換行、引號裡的逗號與換行；自訂欄首對應，下次自動套用', async ({ page }) => {
  await studio(page, '詞表')
  const csv = ['Lexeme,Gloss,Remarks,Region', '"kita, ita",road,"line1\r\nline2",pazeh', 'batu,stone,,pazeh', ''].join('\r\n')
  await page.getByRole('button', { name: '匯入詞表' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(dialog.getByText('list.csv：共 2 列、4 欄')).toBeVisible()
  // Lexeme → 詞形、Gloss（英文內容）→ 英文；Remarks 自動是備註，改成不匯入；Region 自動對到方言
  await expect(dialog.getByLabel('「Lexeme」匯入成')).toHaveValue('text')
  await expect(dialog.getByLabel('「Gloss」匯入成')).toHaveValue('en')
  await dialog.getByLabel('「Remarks」匯入成').selectOption('ignore')
  await expect(dialog.getByLabel('「Region」匯入成')).toHaveValue('dialect')
  await expect(dialog.getByText('會匯入 2 列')).toBeVisible()
  await dialog.getByRole('button', { name: '匯入', exact: true }).click()
  await page.getByPlaceholder('篩選').fill('kita')
  await expect(page.getByRole('textbox', { name: '詞形' })).toHaveValue('kita, ita')
  await expect(page.getByRole('textbox', { name: '英文' })).toHaveValue('road')
  await expect(page.getByRole('textbox', { name: '備註' })).toHaveValue('')

  // 再匯入同樣欄首的檔：套用記住的對應（Remarks 不匯入）；完全相同的列略過
  await page.getByRole('button', { name: '匯入詞表' }).click()
  await dialog.locator('input[type=file]').setInputFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(dialog.getByLabel('「Remarks」匯入成')).toHaveValue('ignore')
  await expect(dialog.getByLabel('「Region」匯入成')).toHaveValue('dialect')
  await expect(dialog.getByText('2 列和現有的資料或前面的列完全相同，會略過')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '匯入', exact: true })).toBeDisabled()

  // 壞掉的 Excel 檔：說明請另存成 CSV
  await dialog.locator('input[type=file]').setInputFiles({ name: 'broken.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]) })
  await expect(dialog.getByRole('alert')).toContainText('CSV UTF-8')
})

test('詞根欄：上傳 CSV（BOM、CRLF）→ 詞表有詞根欄 → 建置 → 查詞根找得到衍生詞，詞條頁顯示「衍生自」', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('roots.csv')
  writeFileSync(file, '﻿詞,詞根,中文\r\nzabuk,,灰塵\r\nmazabuk,zabuk,沾滿灰塵\r\n"mi,zabuk",zabuk,"有逗號\r\n也有換行"\r\n')
  await studio(page, '詞表')
  await page.getByRole('button', { name: '匯入詞表' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles(file)
  await expect(dialog.getByLabel('「詞根」匯入成')).toHaveValue('root')
  await expect(dialog.getByText('會匯入 3 列')).toBeVisible()
  await dialog.getByRole('button', { name: '匯入', exact: true }).click()

  // 詞表有「詞根」欄，值是匯入的
  await page.getByPlaceholder('篩選').fill('mazabuk')
  await expect(page.getByRole('textbox', { name: '詞根' })).toHaveValue('zabuk')
  await page.getByPlaceholder('篩選').fill('mi,zabuk')
  // 單行輸入框不顯示格子裡的換行（資料裡還在）
  await expect(page.getByRole('textbox', { name: '中文' })).toHaveValue('有逗號也有換行')
  await build(page)

  // 查詞根：詞根本身與標了詞根的詞都找得到
  await page.goto('./#/?q=zabuk&f=native')
  const derived = page.locator('article').filter({ hasText: 'mazabuk' }).first()
  await expect(derived).toBeVisible({ timeout: 30_000 })
  await derived.getByRole('link').first().click()
  const morphology = page.getByRole('region', { name: '構詞與變體' })
  await expect(morphology.getByText('衍生自')).toBeVisible()
  await expect(morphology.getByRole('link', { name: 'zabuk', exact: true })).toBeVisible()
})

test('匯入 Excel（.xlsx）：選工作表、詞根欄、建置後查詞根找得到衍生詞；舊版 .xls 說明怎麼辦', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('words.xlsx')
  writeFileSync(
    file,
    workbook([
      { name: '說明', rows: [['這張表不是詞表']] },
      {
        name: '詞表',
        rows: [
          ['Lexeme', 'Root', 'Gloss', 'Count'],
          ['rumaq', null, 'house', 3],
          ['mirumaq', 'rumaq', 'to build a house', 1],
        ],
      },
    ]),
  )
  await studio(page, '詞表')
  await page.getByRole('button', { name: '匯入詞表' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles(file)

  // 多個工作表：預設第一張有內容的（說明），改選「詞表」
  await expect(dialog.getByLabel('工作表')).toBeVisible()
  await dialog.getByLabel('工作表').selectOption({ label: '詞表（3 列）' })
  await expect(dialog.getByLabel('「Lexeme」匯入成')).toHaveValue('text')
  await expect(dialog.getByLabel('「Root」匯入成')).toHaveValue('root')
  await expect(dialog.getByLabel('「Gloss」匯入成')).toHaveValue('en')
  await expect(dialog.getByText('會匯入 2 列')).toBeVisible()
  await dialog.getByRole('button', { name: '匯入', exact: true }).click()

  await page.getByPlaceholder('篩選').fill('mirumaq')
  await expect(page.getByRole('textbox', { name: '詞根' })).toHaveValue('rumaq')
  await expect(page.getByRole('textbox', { name: '英文' })).toHaveValue('to build a house')
  await build(page)
  await page.goto('./#/?q=rumaq&f=native')
  await expect(page.locator('article').filter({ hasText: 'mirumaq' }).first()).toBeVisible({ timeout: 30_000 })

  // 舊版 .xls（二進位格式）：說明請另存新檔
  await studio(page, '詞表')
  await page.getByRole('button', { name: '匯入詞表' }).click()
  await dialog.locator('input[type=file]').setInputFiles({ name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) })
  await expect(dialog.getByRole('alert')).toContainText('舊版的 Excel 檔（.xls）')
})

test('重疊型式：新增一種、選型式、寫意思 → 建置 → 搜尋的標籤直接寫出拆法，重疊用 ~', async ({ page }) => {
  await studio(page, '構詞')
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '重疊型式', exact: true }) })
  // 範例已有兩種重疊（CV、CVV），意思是依語系的說明：顯示預設語系的
  await expect(section.getByRole('combobox', { name: '這一列的重疊型式' })).toHaveCount(2)
  await expect(section.getByRole('textbox', { name: '重疊的意思' }).first()).not.toHaveValue('')

  // 新增：預設選還沒用過的型式，改選「整個詞」，寫意思
  await section.getByRole('button', { name: '新增' }).click()
  const rows = section.getByRole('combobox', { name: '這一列的重疊型式' })
  await expect(rows).toHaveCount(3)
  await rows.nth(2).selectOption('full')
  await section.getByRole('textbox', { name: '重疊的意思' }).nth(2).fill('重複')
  // 同一種型式列兩次：提醒（不擋建置）
  await rows.nth(1).selectOption('full')
  await expect(page.getByText(/重疊型式「full」重複了/)).toBeVisible()
  await rows.nth(1).selectOption('CVV')

  // 詞根 kiliw 在詞表中：查 kiikiliw 是 kii~ ＋ kiliw
  await page.getByRole('tab', { name: '詞表' }).click()
  await page.getByRole('button', { name: '新增一個詞' }).click()
  await page.getByRole('textbox', { name: '詞形' }).last().fill('kiliw')
  await build(page)
  await page.goto('./#/?q=kiikiliw')
  const hit = page.locator('article').filter({ hasText: 'kiliw' }).first()
  await expect(hit.getByRole('button', { name: /自動拆解.*kii~ \+ kiliw/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('kii- + kiliw')).toHaveCount(0)

  // 整個詞重疊：kiliw~kiliw，意思是剛才寫的
  await page.goto('./#/?q=kiliwkiliw')
  const full = page.locator('article').filter({ hasText: 'kiliw' }).first()
  await full.getByRole('button', { name: /自動拆解.*kiliw~ \+ kiliw/ }).click()
  await expect(page.getByRole('dialog').or(page.locator('[role=dialog], [data-reka-popper-content-wrapper]')).getByText('重複').first()).toBeVisible()
})

test('自動同根：詞根不在詞表中時，標籤也直接寫出查詢與命中詞各自的拆法', async ({ page }) => {
  await studio(page, '詞表')
  for (const w of ['mikiliw', 'kiliwen']) {
    await page.getByRole('button', { name: '新增一個詞' }).click()
    await page.getByRole('textbox', { name: '詞形' }).last().fill(w)
  }
  await build(page)
  await page.goto('./#/?q=kiikiliw')
  const hit = page.locator('article').filter({ hasText: 'kiliwen' }).first()
  // 查詢拆成 kii~ + kiliw；這個詞拆成 kiliw + -en
  await expect(hit.getByRole('button', { name: /自動同根.*kii~ \+ kiliw ／ kiliw \+ -en/ })).toBeVisible({ timeout: 30_000 })
})
