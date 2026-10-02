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
    this._nextId = 1
    /** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
    this._pending = new Map()
    /** @type {Promise<{records: number, terms: number}> | null} */
    this._ready = null
    /** @type {Worker | null} */
    this.worker = null
    this._start()
  }

  /**
   * 啟動 Worker。Worker 出錯（載入失敗、記憶體不足而中止）時，等待中的請求一律失敗，
   * Worker 丟掉、索引狀態重設：下一次呼叫會重新啟動並重新載入索引，而不是永遠等不到回應。
   * @private
   */
  _start() {
    const worker = new Worker(new URL('../workers/search.worker.js', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event) => {
      const { id, result, error } = event.data
      const pending = this._pending.get(id)
      if (!pending) return
      this._pending.delete(id)
      if (error) pending.reject(new Error(error))
      else pending.resolve(result)
    })
    worker.addEventListener('error', (event) => {
      event.preventDefault?.()
      const err = new Error(event.message || 'Search worker error')
      for (const p of this._pending.values()) p.reject(err)
      this._pending.clear()
      worker.terminate()
      if (this.worker === worker) {
        this.worker = null
        this._ready = null
      }
    })
    this.worker = worker
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
   * 句型搜尋（babizu/pattern；docs/pattern-query.md）。
   * @param {string} query
   * @param {object} [options] 見 babizu/pattern 的 PatternSearchOptions
   * @returns {Promise<any>} PatternResponse
   */
  async searchPattern(query, options) {
    await this.ready()
    return this._call('searchPattern', { query, options })
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
   * 構詞搜尋（BCDP）的完整說明（演算法實驗室用）。
   * @param {string} query
   * @param {string | null} [term]
   * @param {{fuzziness?: string}} [options]
   * @returns {Promise<any>} 語言設定檔沒有構詞規格時為 null
   */
  async explainMorphology(query, term = null, options) {
    await this.ready()
    return this._call('explainMorphology', { query, term, options })
  }

  /**
   * 檢查清單（/checklist）：頁首統計、例句中沒有詞條的詞、完全相同的詞條、重複的例句。
   * @param {'checklistSummary' | 'checklistTokens' | 'checklistDuplicates' | 'checklistSentences'} method
   * @param {{lexicalSources: string[]} & Record<string, unknown>} params 見 babizu/search 的 Checklist
   * @returns {Promise<any>}
   */
  async checklist(method, params) {
    await this.ready()
    return this._call(method, params)
  }

  /**
   * @param {string} method
   * @param {unknown} params
   * @private
   */
  _call(method, params) {
    const id = this._nextId++
    if (!this.worker) this._start()
    const worker = /** @type {Worker} */ (this.worker)
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject })
      worker.postMessage({ id, method, params })
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
