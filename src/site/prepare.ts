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
 * data/search/derivations.json     自動派生圖（查詞根找到加綴變化；見 src/search/derivations.ts）
 * data/search/parses.json          拆解表（每個詞的所有拆法，句型搜尋的構詞樣式用；見 src/search/parses.ts）
 * data/search/segmentations.json   有人工拆解的記錄（檢查清單的人工拆解對照用；見 src/search/segmentation.ts）
 * data/search/csr.json             對應組檢索的模型（站台設定了 csr 才有；實驗性，見 docs/csr.md）
 * data/media/…、data/scans/…        從資料集複製（增量；已不存在的會刪除）
 * <站台 public/ 的檔案>             站徽等
 * ```
 */

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { readDataset, validateDataset } from '../dataset.ts'
import type { LanguageProfile } from '#bcdp'
import type { ResolvedSite } from './config.ts'
import { buildDerivations } from './derivations.ts'
import { buildSiteData, siteManifest, versionInput } from './site-data.ts'

export { SITE_DATA_VERSION } from './site-data.ts'

/** 由站台的資料集產生網站用的靜態資料（輸出位置與檔案見檔頭）。 */
export async function prepareSiteData(site: ResolvedSite, { log = console.log }: { log?: (message: string) => void } = {}): Promise<{ publicDir: string; records: number; terms: number }> {
  const t0 = Date.now()
  const outRoot = join(site.root, '.babizu', 'public')
  const out = join(outRoot, 'data')

  // 展示版：沒有資料集，網站資料在瀏覽器裡由專案建置（docs/playground.md）；這裡只放範例專案與站台的靜態檔
  if (site.playgroundSample) {
    await rm(out, { recursive: true, force: true })
    await mkdir(join(outRoot, 'playground'), { recursive: true })
    await writeFile(join(outRoot, 'playground', 'sample.json'), JSON.stringify(site.playgroundSample))
    await mirrorPublic(site.publicDir, outRoot)
    await writeFile(join(outRoot, '.nojekyll'), '')
    log(`✓ 展示版：範例專案 ${site.playgroundSample.words.length} 個詞、${site.playgroundSample.sentences.length} 個例句（網站資料在瀏覽器中建置）`)
    return { publicDir: outRoot, records: site.playgroundSample.words.length + site.playgroundSample.sentences.length, terms: 0 }
  }

  // 1. 讀取並驗證資料集
  const loaded = await readDataset(site.dataDir)
  const dialects = site.client.varieties.map((v) => v.code)
  const issues = validateDataset(loaded, { dialects })
  const errors = issues.filter((i) => i.level === 'error')
  for (const w of issues.filter((i) => i.level === 'warn').slice(0, 10)) log(`! ${w.source}：${w.message}`)
  if (errors.length > 0) {
    throw new Error(`資料集驗證失敗（${errors.length} 個錯誤）：\n- ${errors.slice(0, 20).map((e) => `${e.source}：${e.message}`).join('\n- ')}`)
  }

  // 2. 網站資料的內容（site-data.ts；展示版在瀏覽器用同一份程式），依序寫出（壓縮，無縮排）
  await rm(join(out, 'records'), { recursive: true, force: true })
  await rm(join(out, 'search'), { recursive: true, force: true })
  const t1 = Date.now()
  let t2 = t1
  const data = await buildSiteData(
    {
      loaded,
      // 站台設定檢查過語言設定檔（loadSiteConfig 在找不到或格式不對時丟出錯誤）
      profile: site.client.profile as LanguageProfile,
      varieties: site.client.varieties.map((v) => ({ code: v.code, parent: v.parent })),
      csrModel: site.csrModel,
    },
    {
      derive: (args) => buildDerivations({ ...args, cacheDir: join(site.root, '.babizu', 'cache') }),
      onStep: (step) => {
        if (step === 'derivations') t2 = Date.now()
      },
    },
  )
  const fileHashes: Record<string, string> = {}
  for (const [path, content] of data.files) {
    const text = JSON.stringify(content)
    const full = join(out, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, text)
    fileHashes[path] = createHash('sha1').update(text).digest('hex').slice(0, 12)
  }
  const { index, derivations } = data
  log(`✓ 搜尋索引：${data.counts.records} 筆記錄、${index.terms} 個詞、詞圖 ${index.nodes} 節點／${index.edges} 邊（${t2 - t1} ms）`)
  log(
    `✓ 自動派生圖：${derivations.data.edges.length / 3} 條邊、${derivations.data.analyses.length} 種分析；拆解表 ${derivations.parses.edges.length / 3} 種拆法（${derivations.cached ? '快取' : `${Date.now() - t2} ms`}）`,
  )

  // 4. 媒體、掃描圖、站台的靜態檔（增量同步，並刪掉已不存在的檔案）
  const copied =
    (await mirror(join(site.dataDir, 'media'), join(out, 'media'))) +
    (await mirror(join(site.dataDir, 'scans'), join(out, 'scans')))
  await mirrorPublic(site.publicDir, outRoot)
  await writeFile(join(outRoot, '.nojekyll'), '')

  // 5. manifest：版本是所有 JSON 內容的雜湊，資料一變瀏覽器就會取新檔
  const version = createHash('sha1').update(versionInput(fileHashes)).digest('hex').slice(0, 12)
  await writeFile(join(out, 'manifest.json'), JSON.stringify(siteManifest(data, { version, fileHashes, builtAt: new Date().toISOString() })))
  log(`✓ 網站資料：${loaded.length} 個來源、媒體更新 ${copied} 個檔案（共 ${Date.now() - t0} ms）→ ${relative(site.root, out)}`)
  return { publicDir: outRoot, records: data.counts.records, terms: data.counts.terms }
}

/** 列出目錄下所有檔案（相對路徑）。目錄不存在時回傳空陣列。 */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string) => {
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
 * @returns 複製的檔案數
 */
async function mirror(from: string, to: string): Promise<number> {
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

/** 站台 public/ 的檔案複製到輸出根目錄（不刪除 data/）。 */
async function mirrorPublic(from: string, to: string): Promise<void> {
  for (const rel of await listFiles(from)) {
    const src = join(from, rel)
    const dest = join(to, rel)
    if (await isUpToDate(src, dest)) continue
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(src, dest)
  }
}

/** 目的檔存在、大小相同、且修改時間不早於來源檔。 */
async function isUpToDate(from: string, to: string): Promise<boolean> {
  try {
    const [src, dest] = await Promise.all([stat(from), stat(to)])
    return dest.size === src.size && dest.mtimeMs >= src.mtimeMs
  } catch {
    return false
  }
}
