/**
 * @file 展示版的建置 Web Worker：專案 → 網站資料（與 `babizu build` 相同的程式，見 src/playground/build.ts），
 * 存進 IndexedDB 之後回報版本。進度以訊息回報給頁面。
 *
 * 構詞分析（最花時間的一步）分給幾個 derive.worker.ts 平行跑：各自輪流領取下一段詞，結果依段的順序接起來，
 * 與單一執行緒相同（Node 端 src/site/derivations.ts 的做法）。瀏覽器不支援 Worker 裡再開 Worker 時退回單一執行緒。
 *
 * 請求  { project, db, hash }
 * 回應  { type: 'step', step } ｜ { type: 'progress', done, total } ｜ { type: 'done', version, stats } ｜ { type: 'error', message }
 */

import { buildProject } from '@babizu/playground/build.ts'
import type { PlaygroundProject } from '@babizu/playground/project.ts'
import type { RangeAnalysis } from '@babizu/search/derivations.ts'
import { analyzeInProcess, type AnalyzeChunks } from '@babizu/site/site-data.ts'
import { kvSet, putBuild } from '../playground/db.ts'

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 平行分析：幾個 Worker 輪流領取下一段 */
function analyzeParallel(threads: number, onProgress: (done: number, total: number) => void): AnalyzeChunks {
  return ({ lexicon, profile, chunks }) =>
    new Promise((resolve, reject) => {
      const results: RangeAnalysis[] = new Array(chunks.length)
      const total = chunks.length ? chunks[chunks.length - 1].to : 0
      let next = 0
      let finished = 0
      let done = 0
      const workers: Worker[] = []
      const stop = () => workers.forEach((w) => w.terminate())
      for (let k = 0; k < Math.min(threads, chunks.length); k++) {
        const worker = new Worker(new URL('./derive.worker.ts', import.meta.url), { type: 'module' })
        workers.push(worker)
        let current = -1
        const take = () => {
          if (next >= chunks.length) return
          current = next++
          worker.postMessage(chunks[current])
        }
        worker.addEventListener('message', (event: MessageEvent<RangeAnalysis>) => {
          results[current] = event.data
          done += chunks[current].to - chunks[current].from
          onProgress(done, total)
          if (++finished === chunks.length) {
            stop()
            resolve(results)
          } else take()
        })
        worker.addEventListener('error', (event) => {
          stop()
          reject(new Error(event.message || 'Derivation worker error'))
        })
        worker.postMessage({ lexicon, profile })
        take()
      }
      if (chunks.length === 0) resolve([])
    })
}

self.addEventListener('message', async (event: MessageEvent<{ project: PlaygroundProject; db: string; hash: string }>) => {
  const { project, db, hash } = event.data
  try {
    let last = 0
    const progress = (done: number, total: number) => {
      // 不要每一段都送：至少相隔 100 毫秒
      const now = Date.now()
      if (now - last > 100 || done === total) {
        last = now
        self.postMessage({ type: 'progress', done, total })
      }
    }
    const threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
    const analyze = typeof Worker !== 'undefined' && threads > 1 ? analyzeParallel(threads, progress) : analyzeInProcess(progress)
    const build = await buildProject(project, { sha1Hex, analyze, onStep: (step) => self.postMessage({ type: 'step', step }) })
    await putBuild(db, build.version, build.files)
    await kvSet(db, 'build', { hash, version: build.version, stats: build.stats })
    self.postMessage({ type: 'done', version: build.version, stats: build.stats })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})
