/**
 * @file 匯出標準資料集：執行各來源的轉接器 → 驗證 → 寫出資料集 → 同步媒體與掃描圖。
 *
 * 這是「資料生產端」的主流程，通常在存放原始資料的（可能是私有的）儲存庫裡執行，
 * 產出的資料集再交給網站端 `babizu build`。
 *
 * ```js
 * import { exportDataset } from 'babizu/pipeline'
 * import sources from './sources.config.js'
 *
 * await exportDataset({ sources, root: import.meta.dirname, outDir: '../my-site/data', dialects: ['a', 'b'] })
 * ```
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { validateDataset, writeDataset } from '../dataset.js'
import { pruneAssets, syncAssets } from './assets.js'
import { Report } from './report.js'

/**
 * @typedef {object} SourceEntry 來源登錄表的一筆
 * @property {import('./adapter.js').SourceAdapter} adapter
 * @property {string} input 原始資料路徑（相對 root）
 * @property {boolean} [enabled=true] false 時完全不匯出（例如尚未取得公開授權的來源）
 */

/**
 * @typedef {object} ExportOptions
 * @property {SourceEntry[]} sources 來源登錄表（順序即網站上的順序）
 * @property {string} root 原始資料的根目錄（input 的相對基準）
 * @property {string} outDir 資料集輸出目錄
 * @property {string[]} [dialects] 允許的語言變體代碼（通常取自站台設定），用於驗證
 * @property {import('../fuzzy/profile.js').LanguageProfile | null} [profile] 語言設定檔，傳給轉接器使用
 * @property {string[] | null} [only] 只匯出這些來源（開發用；其餘來源會從輸出中消失）
 * @property {boolean} [skipScans] 略過掃描圖轉檔
 * @property {string} [reportFile] 建置報告的輸出路徑（JSON）
 * @property {(message: string) => void} [log]
 */

/**
 * @param {ExportOptions} options
 * @returns {Promise<{ok: boolean, report: Report, records: number}>}
 */
export async function exportDataset({
  sources,
  root,
  outDir,
  dialects,
  profile = null,
  only = null,
  skipScans = false,
  reportFile,
  log = console.log,
}) {
  const started = Date.now()
  const report = new Report()
  const out = resolve(outDir)

  const entries = sources.filter((s) => s.enabled !== false && (!only || only.includes(s.adapter.source.id)))
  if (entries.length === 0) throw new Error('沒有任何要匯出的來源')
  if (only) log(`! 只匯出 ${only.join('、')}：其餘來源會從 ${out} 移除。完整匯出請不要加 --only。`)
  const skipped = sources.filter((s) => s.enabled === false).map((s) => s.adapter.source.id)
  if (skipped.length) log(`· 停用中（不匯出）：${skipped.join('、')}`)

  // 1. 轉接器
  /** @type {import('../dataset.js').LoadedSource[]} */
  const loaded = []
  /** @type {import('./adapter.js').AssetOutput[]} */
  const assets = []
  for (const { adapter, input } of entries) {
    const t0 = Date.now()
    const output = await adapter.load({ root, input: join(root, input), report, profile })
    loaded.push({ source: adapter.source, shards: output.shards })
    assets.push(...output.assets)
    const count = output.shards.reduce((s, sh) => s + sh.records.length, 0)
    log(`✓ ${adapter.source.shortTitle}：${count} 筆記錄、${output.shards.length} 個分片（${Date.now() - t0} ms）`)
  }

  // 2. 驗證
  for (const issue of validateDataset(loaded, { dialects })) {
    if (issue.level === 'error') report.error(issue.source, issue.message)
    else report.warn(issue.source, issue.message)
  }

  const records = loaded.reduce((n, l) => n + l.shards.reduce((m, s) => m + s.records.length, 0), 0)
  if (report.errorCount === 0) {
    // 3. 資料集
    await writeDataset(out, loaded)
    log(`✓ 資料集：${loaded.length} 個來源、${records} 筆記錄 → ${out}`)

    // 4. 媒體與掃描圖
    const t2 = Date.now()
    const stats = await syncAssets(assets, out, { skipScans })
    log(`✓ 資產：複製 ${stats.copied}、轉檔 ${stats.converted}、略過 ${stats.skipped}（${Date.now() - t2} ms）`)
    const removed = await pruneAssets(assets, out)
    if (removed.length) log(`✓ 清除不再引用的資產 ${removed.length} 個：${removed.slice(0, 5).join('、')}${removed.length > 5 ? '…' : ''}`)
  }

  if (reportFile) {
    await mkdir(dirname(reportFile), { recursive: true })
    await writeFile(reportFile, JSON.stringify({ builtAt: new Date().toISOString(), items: report.items }, null, 2))
  }
  if (report.items.length > 0) {
    log(`\n報告：${report.errorCount} 個錯誤、${report.warningCount} 個警告${reportFile ? `（完整內容：${reportFile}）` : ''}`)
    log(report.summary())
  }
  const ok = report.errorCount === 0
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  log(ok ? `\n✓ 匯出完成（${seconds} 秒）` : `\n✗ 匯出失敗（${seconds} 秒）`)
  return { ok, report, records }
}
