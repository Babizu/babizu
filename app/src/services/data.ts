/**
 * @file 靜態資料存取：manifest、來源、分片、單筆記錄，以及媒體與掃描圖網址。
 *
 * 所有 JSON 都在網站的 data/ 目錄（由 `babizu build` 從資料集產生），以 fetch 讀取並快取在記憶體。
 * 網址會加上 manifest 的版本號（?v=…），資料更新後瀏覽器不會拿到舊快取。
 * 網路暫時中斷時自動重試（fetch-retry.ts）；失敗的請求不留在快取裡，之後可以再試。
 *
 * 展示版（site.playground）沒有建置好的檔案：資料由瀏覽器裡的專案建置（playground/builder.ts），
 * 存在 IndexedDB；這裡改從那裡讀同樣路徑的內容。
 */

import type { CorpusShard, CorpusSource } from '@babizu/schema/types.ts'
import site from 'virtual:babizu/site'
import { DB, ensureBuilt } from '../playground/builder.ts'
import { getFile } from '../playground/db.ts'
import { fetchWithRetry } from './fetch-retry.ts'

/** 資料根目錄（相對於網站 base，部署在子路徑也正確） */
const DATA_BASE = `${import.meta.env.BASE_URL}data/`

const cache = new Map<string, Promise<unknown>>()

let manifestPromise: Promise<Manifest> | null = null

export interface ShardInfo {
  key: string
  label: string
  records: number
  groups: number
}

/** 來源後設資料，附上它的分片 */
export type SourceInfo = CorpusSource & { shards: ShardInfo[] }

export interface Manifest {
  schemaVersion: number
  version: string
  builtAt: string
  sources: string[]
  counts: { records: number; terms: number }
  shards: Record<string, ShardInfo[]>
}

/**
 * 資料檔（或媒體、掃描圖）的完整網址。
 * @param path 相對資料根目錄的路徑，例如 media/x/y.mp3
 */
export function dataUrl(path: string) {
  return DATA_BASE + path.split('/').map(encodeURIComponent).join('/')
}

/** 以絕對網址表示的資料根目錄（給 Web Worker 使用，Worker 內的相對路徑基準不同） */
export function absoluteDataBase() {
  return new URL(DATA_BASE, window.location.href).href
}

/**
 * 讀取 manifest（不加版本參數，永遠取最新）。
 */
export function loadManifest(): Promise<Manifest> {
  if (!manifestPromise && site.playground) {
    manifestPromise = ensureBuilt().then(async (version) => {
      const manifest = await getFile<Manifest>(DB, version, 'manifest.json')
      if (!manifest) throw new DataError('The playground build is missing — rebuild the project')
      return manifest
    })
    manifestPromise.catch(() => (manifestPromise = null))
  }
  if (!manifestPromise) {
    manifestPromise = fetchWithRetry(`${DATA_BASE}manifest.json`, { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new DataError('data/manifest.json not found — build the site with `babizu build`', res.status)
      return res.json()
    })
    manifestPromise.catch(() => (manifestPromise = null))
  }
  return manifestPromise
}

/**
 * 讀取資料 JSON（帶版本參數，並快取）。
 * @returns 檔案內容（型別由呼叫端指定，不在執行期檢查：資料由同一版框架建置）
 */
export async function fetchJson<T>(path: string): Promise<T> {
  const manifest = await loadManifest()
  const key = `${path}?v=${manifest.version}`
  let promise = cache.get(key)
  if (!promise && site.playground) {
    promise = getFile<T>(DB, manifest.version, path).then((content) => {
      if (content === undefined) throw new DataError(`Cannot load ${path} from the playground build`, 404)
      return content
    })
    cache.set(key, promise)
    promise.catch(() => cache.delete(key))
  }
  if (!promise) {
    promise = fetchWithRetry(`${dataUrl(path)}?v=${manifest.version}`).then((res) => {
      if (!res.ok) throw new DataError(`Cannot load ${path} (HTTP ${res.status})`, res.status)
      return res.json()
    })
    cache.set(key, promise)
    promise.catch(() => cache.delete(key))
  }
  return promise as Promise<T>
}

/**
 * 來源清單（附分片資訊）。
 */
export async function loadSources(): Promise<SourceInfo[]> {
  const [manifest, sources] = await Promise.all([loadManifest(), fetchJson<CorpusSource[]>('sources.json')])
  return sources.map((s) => ({ ...s, shards: manifest.shards[s.id] ?? [] }))
}

/**
 * 讀取一個分片。
 */
export function loadShard(source: string, shard: string): Promise<CorpusShard> {
  return fetchJson<CorpusShard>(`records/${source}/${shard}.json`)
}

export class DataError extends Error {
  /** HTTP 狀態碼（網路錯誤時沒有） */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'DataError'
    this.status = status
  }
}
