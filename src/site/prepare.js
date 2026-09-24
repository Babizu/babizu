/**
 * @file 網站資料準備：資料集 → 網站用的靜態資料。
 *
 * 在 `<站台>/.babizu/public/` 產生（Vite 以它為 publicDir）：
 *
 * ```
 * data/manifest.json               版本（內容雜湊，供快取失效）、各來源的分片清單
 * data/sources.json                來源後設資料
 * data/records/<來源>/<分片>.json   分片（壓縮，無縮排）
 * data/search/docs.json            搜尋結果顯示用的摘要（欄式）
 * data/search/lexicon.json         序列化的詞圖索引
 * data/search/language.json        建索引時用的語言設定檔（查詢端必須用同一份）
 * data/media/…、data/scans/…        從資料集複製（增量；已不存在的會刪除）
 * <站台 public/ 的檔案>             站徽等
 * ```
 */

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { readDataset, validateDataset } from '../dataset.js'
import { buildSearchIndex } from '../search/index.js'

/** 網站資料格式版本；前端讀到不同版本時會要求重新建置 */
export const SITE_DATA_VERSION = 2

/**
 * @param {import('./config.js').ResolvedSite} site
 * @param {{log?: (message: string) => void}} [options]
 * @returns {Promise<{publicDir: string, records: number, terms: number}>}
 */
export async function prepareSiteData(site, { log = console.log } = {}) {
  const t0 = Date.now()
  const outRoot = join(site.root, '.babizu', 'public')
  const out = join(outRoot, 'data')

  // 1. 讀取並驗證資料集
  const loaded = await readDataset(site.dataDir)
  const dialects = site.client.varieties.map((v) => v.code)
  const issues = validateDataset(loaded, { dialects })
  const errors = issues.filter((i) => i.level === 'error')
  for (const w of issues.filter((i) => i.level === 'warn').slice(0, 10)) log(`! ${w.source}：${w.message}`)
  if (errors.length > 0) {
    throw new Error(`資料集驗證失敗（${errors.length} 個錯誤）：\n- ${errors.slice(0, 20).map((e) => `${e.source}：${e.message}`).join('\n- ')}`)
  }

  // 2. 分片與來源（壓縮輸出）
  await rm(join(out, 'records'), { recursive: true, force: true })
  await rm(join(out, 'search'), { recursive: true, force: true })
  /** @type {Record<string, string>} */
  const fileHashes = {}
  /** @type {Record<string, Array<{key: string, label: string, records: number, groups: number}>>} */
  const shardIndex = {}
  const writeJson = async (/** @type {string} */ path, /** @type {unknown} */ data) => {
    const content = JSON.stringify(data)
    const full = join(out, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content)
    fileHashes[path] = createHash('sha1').update(content).digest('hex').slice(0, 12)
  }
  for (const { source, shards } of loaded) {
    shardIndex[source.id] = []
    for (const shard of shards) {
      await writeJson(`records/${source.id}/${shard.key}.json`, {
        source: source.id,
        shard: shard.key,
        label: shard.label,
        groups: shard.groups,
        records: shard.records,
      })
      shardIndex[source.id].push({ key: shard.key, label: shard.label, records: shard.records.length, groups: shard.groups.length })
    }
  }
  await writeJson('sources.json', loaded.map((l) => l.source))

  // 3. 搜尋索引
  const t1 = Date.now()
  const index = buildSearchIndex({
    items: loaded.flatMap(({ shards }) => shards.flatMap((shard) => shard.records.map((record) => ({ record, shard: shard.key })))),
    groups: loaded.flatMap(({ shards }) => shards.flatMap((s) => s.groups)),
    sourceIds: loaded.map((l) => l.source.id),
    profile: /** @type {any} */ (site.client.profile),
    varieties: site.client.varieties.map((v) => ({ code: v.code, parent: v.parent })),
  })
  await writeJson('search/docs.json', index.docs)
  await writeJson('search/lexicon.json', index.lexicon)
  await writeJson('search/language.json', index.profile)
  log(
    `✓ 搜尋索引：${index.docs.count} 筆記錄、${index.stats.terms} 個詞、詞圖 ${index.stats.nodes} 節點／${index.stats.edges} 邊（${Date.now() - t1} ms）`,
  )

  // 4. 媒體、掃描圖、站台的靜態檔（增量同步，並刪掉已不存在的檔案）
  const copied =
    (await mirror(join(site.dataDir, 'media'), join(out, 'media'))) +
    (await mirror(join(site.dataDir, 'scans'), join(out, 'scans')))
  await mirrorPublic(site.publicDir, outRoot)
  await writeFile(join(outRoot, '.nojekyll'), '')

  // 5. manifest：版本是所有 JSON 內容的雜湊，資料一變瀏覽器就會取新檔
  const version = createHash('sha1').update(Object.entries(fileHashes).sort().flat().join('\n')).digest('hex').slice(0, 12)
  await writeFile(
    join(out, 'manifest.json'),
    JSON.stringify({
      schemaVersion: SITE_DATA_VERSION,
      version,
      builtAt: new Date().toISOString(),
      sources: loaded.map((l) => l.source.id),
      counts: { records: index.docs.count, terms: index.stats.terms },
      shards: shardIndex,
      files: fileHashes,
    }),
  )
  log(`✓ 網站資料：${loaded.length} 個來源、媒體更新 ${copied} 個檔案（共 ${Date.now() - t0} ms）→ ${relative(site.root, out)}`)
  return { publicDir: outRoot, records: index.docs.count, terms: index.stats.terms }
}

/**
 * 列出目錄下所有檔案（相對路徑）。目錄不存在時回傳空陣列。
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFiles(dir) {
  /** @type {string[]} */
  const out = []
  const walk = async (/** @type {string} */ d) => {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else out.push(relative(dir, full))
    }
  }
  await walk(dir)
  return out
}

/**
 * 讓 to 目錄與 from 目錄一致：新的或變動的檔案複製過去，from 沒有的檔案從 to 刪除。
 * @param {string} from
 * @param {string} to
 * @returns {Promise<number>} 複製的檔案數
 */
async function mirror(from, to) {
  const source = await listFiles(from)
  const wanted = new Set(source)
  let copied = 0
  for (const rel of source) {
    const src = join(from, rel)
    const dest = join(to, rel)
    if (await isUpToDate(src, dest)) continue
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(src, dest)
    copied++
  }
  for (const rel of await listFiles(to)) {
    if (!wanted.has(rel)) await rm(join(to, rel))
  }
  return copied
}

/**
 * 站台 public/ 的檔案複製到輸出根目錄（不刪除 data/）。
 * @param {string} from
 * @param {string} to
 */
async function mirrorPublic(from, to) {
  for (const rel of await listFiles(from)) {
    const src = join(from, rel)
    const dest = join(to, rel)
    if (await isUpToDate(src, dest)) continue
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(src, dest)
  }
}

/**
 * 目的檔存在、大小相同、且修改時間不早於來源檔。
 * @param {string} from
 * @param {string} to
 */
async function isUpToDate(from, to) {
  try {
    const [src, dest] = await Promise.all([stat(from), stat(to)])
    return dest.size === src.size && dest.mtimeMs >= src.mtimeMs
  } catch {
    return false
  }
}
