/**
 * @file 主執行緒端的搜尋用戶端：包裝與 Web Worker 的訊息往返，對外提供 Promise API。
 */

import { absoluteDataBase, loadManifest } from './data.js'

/**
 * @typedef {import('@babizu/search/index.js').SearchEngine} SearchEngine
 * @typedef {ReturnType<SearchEngine['search']>} SearchResponse
 * @typedef {ReturnType<SearchEngine['neighbors']>} NeighborHits
 * @typedef {import('@babizu/search/index.js').DocSummary} DocSummary
 */

export class SearchClient {
  constructor() {
    this.worker = new Worker(new URL('../workers/search.worker.js', import.meta.url), { type: 'module' })
    this._nextId = 1
    /** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
    this._pending = new Map()
    this.worker.addEventListener('message', (event) => {
      const { id, result, error } = event.data
      const pending = this._pending.get(id)
      if (!pending) return
      this._pending.delete(id)
      if (error) pending.reject(new Error(error))
      else pending.resolve(result)
    })
    this.worker.addEventListener('error', (event) => {
      const err = new Error(event.message || 'Search worker error')
      for (const p of this._pending.values()) p.reject(err)
      this._pending.clear()
    })
    /** @type {Promise<{records: number, terms: number}> | null} */
    this._ready = null
  }

  /**
   * 載入索引（可重複呼叫，只會載入一次）。
   * @returns {Promise<{records: number, terms: number}>}
   */
  ready() {
    if (!this._ready) {
      this._ready = loadManifest().then((manifest) =>
        this._call('init', { dataBase: absoluteDataBase(), version: manifest.version }),
      )
      this._ready.catch(() => (this._ready = null))
    }
    return this._ready
  }

  /**
   * @param {string} query
   * @param {object} [options] 見 babizu/search 的 SearchOptions
   * @returns {Promise<SearchResponse>}
   */
  async search(query, options) {
    await this.ready()
    return this._call('search', { query, options })
  }

  /**
   * @param {string} id
   * @param {object} [options]
   * @returns {Promise<NeighborHits>}
   */
  async neighbors(id, options) {
    await this.ready()
    return this._call('neighbors', { id, options })
  }

  /**
   * @param {string} id
   * @returns {Promise<DocSummary | null>}
   */
  async docById(id) {
    await this.ready()
    return this._call('docById', { id })
  }

  /**
   * 依條件列出記錄（資料來源頁的詞彙清單）。
   * @param {object} [options] 見 babizu/search 的 ListOptions
   * @returns {Promise<{items: DocSummary[], total: number}>}
   */
  async list(options) {
    await this.ready()
    return this._call('list', options ?? {})
  }

  /**
   * @param {string} method
   * @param {unknown} params
   * @private
   */
  _call(method, params) {
    const id = this._nextId++
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, method, params })
    })
  }
}

/** @type {SearchClient | null} */
let instance = null

/** 全站共用一個 Worker */
export function getSearchClient() {
  if (!instance) instance = new SearchClient()
  return instance
}
