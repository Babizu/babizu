/**
 * @file 網站資產同步：複製媒體檔、把掃描圖轉成 WebP。
 *
 * 兩者都是「增量」的：目的檔已存在且不比來源舊就略過，重跑建置不會重做 278 張圖。
 */

import { copyFile, mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

/**
 * sharp 是選用的相依套件（只有要轉掃描圖的資料生產端需要），用到時才載入。
 * @returns {Promise<typeof import('sharp')>}
 */
async function loadSharp() {
  try {
    return (await import('sharp')).default
  } catch (e) {
    throw new Error('轉換掃描圖需要 sharp，請在資料生產端的專案執行 `npm install sharp`', { cause: e })
  }
}

/** 掃描圖轉檔設定：寬 1400px 足以辨識小字，單張約 150–250 KB */
export const SCAN_OPTIONS = Object.freeze({ width: 1400, quality: 72 })

/**
 * @param {import('./adapter.js').AssetOutput[]} assets
 * @param {string} outDir 網站資料根目錄
 * @param {{skipScans?: boolean, concurrency?: number, onProgress?: (done: number, total: number) => void}} [options]
 * @returns {Promise<{copied: number, converted: number, skipped: number}>}
 */
export async function syncAssets(assets, outDir, { skipScans = false, concurrency = 4, onProgress } = {}) {
  const stats = { copied: 0, converted: 0, skipped: 0 }
  const queue = assets.filter((a) => !(skipScans && a.kind === 'scan'))
  stats.skipped += assets.length - queue.length
  let done = 0

  const worker = async () => {
    for (;;) {
      const asset = queue.shift()
      if (!asset) return
      const dest = join(outDir, asset.to)
      if (await isUpToDate(asset.from, dest)) {
        stats.skipped++
      } else {
        await mkdir(dirname(dest), { recursive: true })
        if (asset.kind === 'scan') {
          const sharp = await loadSharp()
          await sharp(asset.from)
            .resize({ width: SCAN_OPTIONS.width, withoutEnlargement: true })
            .webp({ quality: SCAN_OPTIONS.quality })
            .toFile(dest)
          stats.converted++
        } else {
          await copyFile(asset.from, dest)
          stats.copied++
        }
      }
      done++
      onProgress?.(done, assets.length)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  return stats
}

/** 由轉接器管理的資產目錄（資料集根目錄下） */
export const ASSET_DIRS = Object.freeze(['media', 'scans'])

/**
 * 刪除資產目錄中不再被任何來源引用的檔案（與空目錄）。
 *
 * 資料集常放在公開的 repo：來源停用或刪掉某個檔案後，舊檔若留在輸出目錄，
 * 就會跟著被提交出去。所以匯出時一律清掉沒有人引用的檔案。
 *
 * @param {import('./adapter.js').AssetOutput[]} assets 本次匯出的所有資產（含 skipScans 略過轉檔的掃描圖）
 * @param {string} outDir 資料集根目錄
 * @returns {Promise<string[]>} 刪除的檔案（相對 outDir，以 / 分隔）
 */
export async function pruneAssets(assets, outDir) {
  const wanted = new Set(assets.map((a) => a.to.split(/[\\/]/u).join('/')))
  const removed = []
  for (const dir of ASSET_DIRS) {
    const root = join(outDir, dir)
    let entries
    try {
      entries = await readdir(root, { recursive: true, withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const full = join(entry.parentPath, entry.name)
      const rel = relative(outDir, full).split(sep).join('/')
      if (wanted.has(rel)) continue
      await rm(full)
      removed.push(rel)
    }
    // 由深到淺刪除空目錄
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(e.parentPath, e.name))
      .sort((a, b) => b.length - a.length)
    for (const d of [...dirs, root]) {
      if ((await readdir(d)).length === 0) await rmdir(d)
    }
  }
  return removed
}

/**
 * 目的檔存在且修改時間不早於來源檔。
 * @param {string} from
 * @param {string} to
 */
async function isUpToDate(from, to) {
  try {
    const [src, dest] = await Promise.all([stat(from), stat(to)])
    return dest.mtimeMs >= src.mtimeMs && dest.size > 0
  } catch {
    return false
  }
}
