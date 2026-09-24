/**
 * @file 靜態資料存取：manifest、來源、分片、單筆記錄，以及媒體與掃描圖網址。
 *
 * 所有 JSON 都在網站的 data/ 目錄（由 `babizu build` 從資料集產生），以 fetch 讀取並快取在記憶體。
 * 網址會加上 manifest 的版本號（?v=…），資料更新後瀏覽器不會拿到舊快取。
 */

/** 資料根目錄（相對於網站 base，部署在子路徑也正確） */
const DATA_BASE = `${import.meta.env.BASE_URL}data/`

/** @type {Map<string, Promise<any>>} */
const cache = new Map()

/** @type {Promise<Manifest> | null} */
let manifestPromise = null

/**
 * @typedef {object} ShardInfo
 * @property {string} key
 * @property {string} label
 * @property {number} records
 * @property {number} groups
 */

/**
 * @typedef {object} Manifest
 * @property {number} schemaVersion
 * @property {string} version
 * @property {string} builtAt
 * @property {string[]} sources
 * @property {{records: number, terms: number}} counts
 * @property {Record<string, ShardInfo[]>} shards
 */

/**
 * 資料檔（或媒體、掃描圖）的完整網址。
 * @param {string} path 相對資料根目錄的路徑，例如 media/x/y.mp3
 */
export function dataUrl(path) {
  return DATA_BASE + path.split('/').map(encodeURIComponent).join('/')
}

/** 以絕對網址表示的資料根目錄（給 Web Worker 使用，Worker 內的相對路徑基準不同） */
export function absoluteDataBase() {
  return new URL(DATA_BASE, window.location.href).href
}

/**
 * 讀取 manifest（不加版本參數，永遠取最新）。
 * @returns {Promise<Manifest>}
 */
export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${DATA_BASE}manifest.json`, { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new DataError('data/manifest.json not found — build the site with `babizu build`', res.status)
      return res.json()
    })
    manifestPromise.catch(() => (manifestPromise = null))
  }
  return manifestPromise
}

/**
 * 讀取資料 JSON（帶版本參數，並快取）。
 * @param {string} path
 */
export async function fetchJson(path) {
  const manifest = await loadManifest()
  const key = `${path}?v=${manifest.version}`
  let promise = cache.get(key)
  if (!promise) {
    promise = fetch(`${dataUrl(path)}?v=${manifest.version}`).then((res) => {
      if (!res.ok) throw new DataError(`Cannot load ${path} (HTTP ${res.status})`, res.status)
      return res.json()
    })
    cache.set(key, promise)
    promise.catch(() => cache.delete(key))
  }
  return promise
}

/**
 * 來源清單（附分片資訊）。
 * @returns {Promise<Array<import('babizu/schema/types').CorpusSource & {shards: ShardInfo[]}>>}
 */
export async function loadSources() {
  const [manifest, sources] = await Promise.all([loadManifest(), fetchJson('sources.json')])
  return sources.map((/** @type {any} */ s) => ({ ...s, shards: manifest.shards[s.id] ?? [] }))
}

/**
 * 讀取一個分片。
 * @param {string} source
 * @param {string} shard
 * @returns {Promise<import('babizu/schema/types').CorpusShard>}
 */
export function loadShard(source, shard) {
  return fetchJson(`records/${source}/${shard}.json`)
}

export class DataError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status) {
    super(message)
    this.name = 'DataError'
    this.status = status
  }
}
