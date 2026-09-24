/**
 * @file 搜尋 Web Worker。
 *
 * 在背景執行緒載入索引並執行查詢，避免模糊搜尋阻塞畫面捲動與輸入。
 * 與主執行緒以簡單的訊息協定溝通（見 services/search-client.js）：
 *   請求  { id, method, params }
 *   回應  { id, result } 或 { id, error }
 *
 * 語言設定檔（search/language.json）和索引一起載入：它就是建索引時用的那一份，
 * 查詢端用它產生搜尋鍵與距離函式，結果才會和建置端一致。
 * 錯誤訊息是給開發者看的技術細節，介面會另外加上翻譯過的說明。
 */

import { SearchEngine } from '@babizu/search/index.js'

/** @type {SearchEngine | null} */
let engine = null
/** @type {Promise<SearchEngine> | null} */
let loading = null

/**
 * @param {{dataBase: string, version: string}} params
 */
async function init({ dataBase, version }) {
  if (!loading) {
    loading = (async () => {
      const fetchJson = async (/** @type {string} */ path) => {
        const res = await fetch(`${dataBase}${path}?v=${version}`)
        if (!res.ok) throw new Error(`Cannot load ${path} (HTTP ${res.status})`)
        return res.json()
      }
      const [docs, lexicon, profile] = await Promise.all([
        fetchJson('search/docs.json'),
        fetchJson('search/lexicon.json'),
        fetchJson('search/language.json'),
      ])
      engine = new SearchEngine({ docs, lexicon, profile })
      engine.warmup()
      return engine
    })()
    loading.catch(() => (loading = null))
  }
  const ready = await loading
  return { records: ready.size, terms: ready.index.size }
}

/** 需要索引就緒的方法 */
const methods = {
  /** @param {{query: string, options?: object}} p */
  search: (p) => requireEngine().search(p.query, p.options),
  /** @param {{id: string, options?: object}} p */
  neighbors: (p) => requireEngine().neighbors(p.id, p.options),
  /** @param {{id: string}} p */
  docById: (p) => requireEngine().docById(p.id),
  /** @param {object} p 見 babizu/search 的 ListOptions */
  list: (p) => requireEngine().list(p),
  /** @param {{query: string, term: string}} p */
  explainNotes: (p) => requireEngine().explainNotes(p.query, p.term),
}

function requireEngine() {
  if (!engine) throw new Error('Search index is not loaded')
  return engine
}

self.addEventListener('message', async (event) => {
  const { id, method, params } = event.data ?? {}
  try {
    let result
    if (method === 'init') {
      result = await init(params)
    } else {
      if (!engine && loading) await loading
      const fn = methods[/** @type {keyof typeof methods} */ (method)]
      if (!fn) throw new Error(`Unknown method: ${method}`)
      result = fn(params)
    }
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
