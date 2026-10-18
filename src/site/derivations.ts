/**
 * @file 網站建置：自動派生圖（search/derivations.json，見 src/search/derivations.ts）與
 * 拆解表（search/parses.json，見 src/search/parses.ts）。兩者來自同一次 BCDP：自動派生圖取每個詞最好的詞根，拆解表全收。
 *
 * 要對詞庫中每個詞各跑一次構詞搜尋（1 萬個詞約 30 秒），所以：
 * - 以 worker_threads 平行計算：詞編號切成小塊，各執行緒輪流領取；結果依詞編號接起來，與單執行緒相同。
 * - 以「詞圖、語言設定檔、分析程式」的雜湊快取在 `.babizu/cache/`：資料與程式沒有變動時不重算。
 *   分析程式是 BCDP 套件與搜尋層的 derivations、parses、text（開發時改了演算法、還沒升版本也會重算）。
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { LanguageProfile, SerializedIndex } from '#bcdp'
import type { DerivationData, RangeAnalysis } from '../search/derivations.ts'
import type { ParseData } from '../search/parses.ts'
import { FRAMEWORK_ROOT } from './paths.ts'
import { computeDerivations, type AnalyzeChunks } from './site-data.ts'

/** 這個模組的副檔名：框架目錄中直接執行原始碼時是 .ts，安裝後執行編譯結果時是 .js（worker 用同一種） */
const EXT = extname(fileURLToPath(import.meta.url))

/**
 * 建置自動派生圖與拆解表（有快取時直接讀）。
 * @returns data 是自動派生圖，parses 是拆解表
 */
export async function buildDerivations({
  lexicon,
  profile,
  count,
  cacheDir,
}: {
  lexicon: SerializedIndex
  profile: LanguageProfile
  count: number
  cacheDir: string
}): Promise<{ data: DerivationData; parses: ParseData; cached: boolean }> {
  const hash = createHash('sha1').update(JSON.stringify([profile, lexicon]))
  for (const source of await analysisSources()) hash.update(await readFile(source))
  const key = hash.digest('hex').slice(0, 16)
  const file = join(cacheDir, `derivations-${key}.json`)
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'))
    return { data: cached.derivations, parses: cached.parses, cached: true }
  } catch {
    // 沒有快取
  }
  const { data, parses } = await computeDerivations({ lexicon, profile, count }, analyzeParallel)
  await mkdir(cacheDir, { recursive: true })
  for (const name of await readdir(cacheDir)) if (name.startsWith('derivations-')) await rm(join(cacheDir, name), { force: true })
  await writeFile(file, JSON.stringify({ derivations: data, parses }))
  return { data, parses, cached: false }
}

/**
 * 分析結果取決於哪些程式（快取鍵的一部分）：BCDP 套件的模組、搜尋層的 derivations、parses、text，與 site-data（兩個階段的合併）。
 * 原始碼與編譯結果（存在的）都算：不論執行的是哪一份，演算法改了快取就失效。
 */
async function analysisSources(): Promise<string[]> {
  const files: string[] = []
  for (const dir of [join(FRAMEWORK_ROOT, 'packages', 'bcdp', 'src'), join(FRAMEWORK_ROOT, 'packages', 'bcdp', 'dist')]) {
    if (!existsSync(dir)) continue
    for (const name of (await readdir(dir)).filter((n) => /\.(js|ts)$/.test(n) && !n.endsWith('.d.ts')).sort()) files.push(join(dir, name))
  }
  for (const name of ['derivations', 'parses', 'text']) {
    for (const file of [join(FRAMEWORK_ROOT, 'src', 'search', `${name}.ts`), join(FRAMEWORK_ROOT, 'dist', 'search', `${name}.js`)]) {
      if (existsSync(file)) files.push(file)
    }
  }
  for (const file of [join(FRAMEWORK_ROOT, 'src', 'site', 'site-data.ts'), join(FRAMEWORK_ROOT, 'dist', 'site', 'site-data.js')]) if (existsSync(file)) files.push(file)
  return files
}

/** 以 worker_threads 平行分析（各執行緒輪流領取下一段；結果依段的順序，與單一執行緒相同） */
const analyzeParallel: AnalyzeChunks = async ({ lexicon, profile, chunks }) => {
  const results: RangeAnalysis[] = new Array(chunks.length)
  let next = 0
  const threads = Math.max(1, Math.min(availableParallelism() - 1, chunks.length))
  await Promise.all(
    Array.from(
      { length: threads },
      () =>
        new Promise((resolve, reject) => {
          const worker = new Worker(new URL(`./derivations-worker${EXT}`, import.meta.url), { workerData: { lexicon, profile } })
          const take = () => {
            if (next >= chunks.length) {
              worker.terminate().then(resolve, reject)
              return
            }
            const k = next++
            worker.once('message', (result: RangeAnalysis) => {
              results[k] = result
              take()
            })
            worker.postMessage(chunks[k])
          }
          worker.once('error', reject)
          take()
        }),
    ),
  )
  return results
}
