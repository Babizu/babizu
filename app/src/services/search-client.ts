/**
 * @file 主執行緒端的搜尋用戶端：包裝與 Web Worker 的訊息往返，對外提供 Promise API。
 *
 * 每個方法的參數與回傳型別都由 Worker 的方法表（workers/search.worker.ts 的 WorkerMethods）推出，
 * 兩端不會對不上。
 */

import type { DocSummary, SearchEngine } from '@babizu/search/index.ts'
import type { WorkerMethods } from '../workers/search.worker.ts'
import { absoluteDataBase, loadManifest } from './data.ts'
import { DB } from '../playground/builder.ts'
import site from 'virtual:babizu/site'

export type SearchResponse = ReturnType<SearchEngine['search']>
export type NeighborHits = ReturnType<SearchEngine['neighbors']>
export type { DocSummary }

type Method = keyof WorkerMethods
/** 方法的參數 */
type ParamsOf<M extends Method> = Parameters<WorkerMethods[M]>[0]
/** 方法的結果（Worker 端的 Promise 已經解開） */
type ResultOf<M extends Method> = Awaited<ReturnType<WorkerMethods[M]>>
/** Worker 方法的結果（元件的 props 用） */
export type WorkerResult<M extends Method> = ResultOf<M>
/** 檢查清單的方法 */
export type ChecklistMethod = 'checklistSummary' | 'checklistTokens' | 'checklistDuplicates' | 'checklistSentences' | 'checklistSegmentations'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class SearchClient {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  /** 索引載入中或已載入（失敗時重設，下次重新載入） */
  private loaded: Promise<ResultOf<'init'>> | null = null
  private worker: Worker | null = null

  constructor() {
    this.start()
  }

  /**
   * 啟動 Worker。Worker 出錯（載入失敗、記憶體不足而中止）時，等待中的請求一律失敗，
   * Worker 丟掉、索引狀態重設：下一次呼叫會重新啟動並重新載入索引，而不是永遠等不到回應。
   */
  private start(): Worker {
    const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const { id, result, error } = event.data
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      if (error) pending.reject(new Error(error))
      else pending.resolve(result)
    })
    worker.addEventListener('error', (event) => {
      event.preventDefault?.()
      const err = new Error(event.message || 'Search worker error')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      worker.terminate()
      if (this.worker === worker) {
        this.worker = null
        this.loaded = null
      }
    })
    this.worker = worker
    return worker
  }

  /** 載入索引（可重複呼叫，只會載入一次）。 */
  ready(): Promise<{ records: number; terms: number }> {
    if (!this.loaded) {
      const loaded = loadManifest().then((manifest) =>
        this.call('init', { dataBase: absoluteDataBase(), version: manifest.version, csr: site.csr, ...(site.playground ? { playground: DB } : {}) }),
      )
      loaded.catch(() => {
        if (this.loaded === loaded) this.loaded = null
      })
      this.loaded = loaded
    }
    return this.loaded
  }

  /** 一般搜尋（babizu/search 的 SearchEngine.search）。 */
  async search(query: string, options?: ParamsOf<'search'>['options']): Promise<ResultOf<'search'>> {
    await this.ready()
    return this.call('search', { query, options })
  }

  /** 句型搜尋（babizu/pattern；docs/pattern-query.md）。 */
  async searchPattern(query: string, options?: ParamsOf<'searchPattern'>['options']): Promise<ResultOf<'searchPattern'>> {
    await this.ready()
    return this.call('searchPattern', { query, options })
  }

  /** 跨來源相近詞。 */
  async neighbors(id: string, options?: ParamsOf<'neighbors'>['options']): Promise<ResultOf<'neighbors'>> {
    await this.ready()
    return this.call('neighbors', { id, options })
  }

  async docById(id: string): Promise<ResultOf<'docById'>> {
    await this.ready()
    return this.call('docById', { id })
  }

  /** 依條件列出記錄（資料來源頁的詞彙清單）。 */
  async list(options: ParamsOf<'list'> = {}): Promise<ResultOf<'list'>> {
    await this.ready()
    return this.call('list', options)
  }

  /**
   * 構詞搜尋（BCDP）的完整說明（演算法實驗室用）。
   * @returns 語言設定檔沒有構詞規格時為 null
   */
  async explainMorphology(query: string, term: string | null = null, options?: ParamsOf<'explainMorphology'>['options']): Promise<ResultOf<'explainMorphology'>> {
    await this.ready()
    return this.call('explainMorphology', { query, term, options })
  }

  /** 檢查清單（/checklist）：頁首統計、例句中沒有詞條的詞、完全相同的詞條、重複的例句、人工拆解對照。 */
  async checklist<M extends ChecklistMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    await this.ready()
    return this.call(method, params)
  }

  private call<M extends Method>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const id = this.nextId++
    const worker = this.worker ?? this.start()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      worker.postMessage({ id, method, params })
    })
  }
}

let instance: SearchClient | null = null

/** 全站共用一個 Worker */
export function getSearchClient(): SearchClient {
  if (!instance) instance = new SearchClient()
  return instance
}
