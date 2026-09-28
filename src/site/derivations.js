/**
 * @file 網站建置：衍生關係圖（search/derivations.json，見 src/search/derivations.js）。
 *
 * 要對詞庫中每個詞各跑一次構詞搜尋（1 萬個詞約 30 秒），所以：
 * - 以 worker_threads 平行計算：詞編號切成小塊，各執行緒輪流領取；結果依詞編號接起來，與單執行緒相同。
 * - 以「詞圖、語言設定檔、框架版本」的雜湊快取在 `.babizu/cache/`：資料沒有變動時不重算。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { encodeDerivations } from '../search/derivations.js'

/** 每次領取的詞數：小塊讓各執行緒的工作量平均 */
const CHUNK = 250

/**
 * @param {{
 *   lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex,
 *   profile: import('../fuzzy/profile.js').LanguageProfile,
 *   count: number,
 *   cacheDir: string,
 * }} input
 * @returns {Promise<{data: import('../search/derivations.js').DerivationData, cached: boolean}>}
 */
export async function buildDerivations({ lexicon, profile, count, cacheDir }) {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  const key = createHash('sha1').update(JSON.stringify([pkg.version, profile, lexicon])).digest('hex').slice(0, 16)
  const file = join(cacheDir, `derivations-${key}.json`)
  try {
    return { data: JSON.parse(await readFile(file, 'utf8')), cached: true }
  } catch {
    // 沒有快取
  }
  const edges = profile.morphology ? await analyzeParallel(lexicon, profile, count) : []
  const data = encodeDerivations(edges, count)
  await mkdir(cacheDir, { recursive: true })
  for (const name of await readdir(cacheDir)) if (name.startsWith('derivations-')) await rm(join(cacheDir, name), { force: true })
  await writeFile(file, JSON.stringify(data))
  return { data, cached: false }
}

/**
 * @param {import('../fuzzy/fuzzy-index.js').SerializedIndex} lexicon
 * @param {import('../fuzzy/profile.js').LanguageProfile} profile
 * @param {number} count
 */
async function analyzeParallel(lexicon, profile, count) {
  const chunks = []
  for (let from = 0; from < count; from += CHUNK) chunks.push({ from, to: Math.min(count, from + CHUNK) })
  /** @type {Array<Array<{word: number, root: number, analysis: any}>>} */
  const results = new Array(chunks.length)
  let next = 0
  const threads = Math.max(1, Math.min(availableParallelism() - 1, chunks.length))
  await Promise.all(
    Array.from(
      { length: threads },
      () =>
        new Promise((resolve, reject) => {
          const worker = new Worker(new URL('./derivations-worker.js', import.meta.url), { workerData: { lexicon, profile } })
          const take = () => {
            if (next >= chunks.length) {
              worker.terminate().then(resolve, reject)
              return
            }
            const k = next++
            worker.once('message', (edges) => {
              results[k] = edges
              take()
            })
            worker.postMessage(chunks[k])
          }
          worker.once('error', reject)
          take()
        }),
    ),
  )
  return results.flat()
}
