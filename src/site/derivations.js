/**
 * @file 網站建置：自動派生圖（search/derivations.json，見 src/search/derivations.js）。
 *
 * 要對詞庫中每個詞各跑一次構詞搜尋（1 萬個詞約 30 秒），所以：
 * - 以 worker_threads 平行計算：詞編號切成小塊，各執行緒輪流領取；結果依詞編號接起來，與單執行緒相同。
 * - 以「詞圖、語言設定檔、分析程式」的雜湊快取在 `.babizu/cache/`：資料與程式沒有變動時不重算。
 *   分析程式是 src/fuzzy/ 與 src/search/derivations.js 的原始碼（開發時改了演算法、還沒升版本也會重算）。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { createDerivationAnalyzer, encodeDerivations, mergeEdges } from '../search/derivations.js'

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
  const hash = createHash('sha1').update(JSON.stringify([profile, lexicon]))
  for (const source of await analysisSources()) hash.update(await readFile(source))
  const key = hash.digest('hex').slice(0, 16)
  const file = join(cacheDir, `derivations-${key}.json`)
  try {
    return { data: JSON.parse(await readFile(file, 'utf8')), cached: true }
  } catch {
    // 沒有快取
  }
  // 第 1 階段（詞庫中的詞根）平行計算；第 2 階段（虛擬詞根）要看全部的邊，只用構詞分析器，在這裡算
  const lexical = profile.morphology ? await analyzeParallel(lexicon, profile, count) : []
  const virtual = profile.morphology ? createDerivationAnalyzer({ lexicon, profile }).virtual(lexical) : []
  const data = encodeDerivations(mergeEdges(lexical, virtual), count)
  await mkdir(cacheDir, { recursive: true })
  for (const name of await readdir(cacheDir)) if (name.startsWith('derivations-')) await rm(join(cacheDir, name), { force: true })
  await writeFile(file, JSON.stringify(data))
  return { data, cached: false }
}

/** 分析結果取決於哪些原始碼（快取鍵的一部分） */
async function analysisSources() {
  const fuzzy = new URL('../fuzzy/', import.meta.url)
  const names = (await readdir(fuzzy)).filter((n) => n.endsWith('.js')).sort()
  return [...names.map((n) => new URL(n, fuzzy)), new URL('../search/derivations.js', import.meta.url), new URL('../search/text.js', import.meta.url)]
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
