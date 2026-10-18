/**
 * @file 展示版：確定目前的專案已經建置好（沒有就在 Web Worker 裡建置），並提供建置的進度給畫面。
 *
 * 專案的雜湊（內容＋前端的建置代號：每次 `babizu build` 都不同，框架改版後舊的建置結果不再使用）對到一個資料版本；
 * 對得上而且檔案還在，就直接用 IndexedDB 裡的資料，不重建。
 */

import { ref } from 'vue'
import type { BuildStep } from '@babizu/playground/build.ts'
import type { PlaygroundProject } from '@babizu/playground/project.ts'
import site from 'virtual:babizu/site'
import { dbName, getFile, kvGet } from './db.ts'
import { currentProject } from './runtime.ts'

/** 建置的狀態：idle 沒有在建置；error 失敗（message 是技術細節） */
export interface BuildState {
  step: BuildStep | 'idle' | 'error'
  done: number
  total: number
  message: string | null
}

export const buildState = ref<BuildState>({ step: 'idle', done: 0, total: 0, message: null })

export const DB = dbName(site.id)

/** 專案的雜湊（決定要不要重建） */
export async function projectHash(project: PlaygroundProject): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${__BABIZU_BUILD_ID__}\n${JSON.stringify(project)}`))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

let ensured: Promise<string> | null = null

/** 目前專案的資料版本（需要時先建置） */
export function ensureBuilt(): Promise<string> {
  if (!ensured) {
    ensured = build(currentProject)
    ensured.catch(() => (ensured = null))
  }
  return ensured
}

async function build(project: PlaygroundProject): Promise<string> {
  const hash = await projectHash(project)
  const pointer = await kvGet<{ hash: string; version: string }>(DB, 'build')
  if (pointer?.hash === hash && (await getFile(DB, pointer.version, 'manifest.json'))) return pointer.version
  buildState.value = { step: 'dataset', done: 0, total: 0, message: null }
  const worker = new Worker(new URL('../workers/build.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<string>((resolve, reject) => {
      worker.addEventListener('message', (event: MessageEvent<{ type: string; step?: BuildStep; done?: number; total?: number; version?: string; message?: string }>) => {
        const m = event.data
        if (m.type === 'step') buildState.value = { ...buildState.value, step: m.step as BuildStep }
        else if (m.type === 'progress') buildState.value = { ...buildState.value, done: m.done ?? 0, total: m.total ?? 0 }
        else if (m.type === 'done') {
          buildState.value = { step: 'idle', done: 0, total: 0, message: null }
          resolve(m.version as string)
        } else if (m.type === 'error') reject(new Error(m.message))
      })
      worker.addEventListener('error', (event) => reject(new Error(event.message || 'Build worker error')))
      // 送出可以結構化複製的純資料（專案可能是工作台的反應式物件）
      worker.postMessage({ project: JSON.parse(JSON.stringify(project)), db: DB, hash })
    })
  } catch (err) {
    buildState.value = { step: 'error', done: 0, total: 0, message: err instanceof Error ? err.message : String(err) }
    throw err
  } finally {
    worker.terminate()
  }
}
