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
 * 拆解表（search/parses.json，句型搜尋的構詞樣式用）比較大，第一次遇到需要它的句型查詢時才載入。
 * 人工拆解（search/segmentations.json，檢查清單的人工拆解對照用）在第一次用到對照時才載入；
 * 有人工拆解、而且有構詞規格時，也一併載入拆解表（對照要用）。檢查清單的其他部分不等它們。
 * 錯誤訊息是給開發者看的技術細節，介面會另外加上翻譯過的說明。
 */

import { Checklist, SearchEngine } from '@babizu/search/index.js'
import { fetchWithRetry } from '../services/fetch-retry.js'

/** @type {SearchEngine | null} */
let engine = null
/** @type {Promise<SearchEngine> | null} */
let loading = null
/** @type {{dataBase: string, version: string} | null} 資料的位置（延後載入的檔案用） */
let source = null
/** @type {Promise<void> | null} 拆解表載入中 */
let parsesLoading = null

/** @param {{dataBase: string, version: string}} at @param {string} path */
async function fetchJson({ dataBase, version }, path) {
  const res = await fetchWithRetry(`${dataBase}${path}?v=${version}`)
  if (!res.ok) throw new Error(`Cannot load ${path} (HTTP ${res.status})`)
  return res.json()
}

/**
 * @param {{dataBase: string, version: string}} params
 */
async function init({ dataBase, version }) {
  if (!loading) {
    source = { dataBase, version }
    const at = source
    loading = (async () => {
      const [docs, lexicon, profile, derivations] = await Promise.all([
        fetchJson(at, 'search/docs.json'),
        fetchJson(at, 'search/lexicon.json'),
        fetchJson(at, 'search/language.json'),
        fetchJson(at, 'search/derivations.json'),
      ])
      engine = new SearchEngine({ docs, lexicon, profile, derivations })
      engine.warmup()
      return engine
    })()
    loading.catch(() => (loading = null))
  }
  const ready = await loading
  return { records: ready.size, terms: ready.index.size }
}

/** @type {Checklist | null} 檢查清單（依辭典來源建立，計算結果留著給下一頁用） */
let checklist = null
/** @type {Promise<any> | null} 人工拆解（沒有這個檔案的舊建置是 null） */
let segmentationsLoading = null
/** @param {{lexicalSources: string[]}} p */
function checklistFor({ lexicalSources }) {
  const engine = requireEngine()
  if (!checklist || checklist.engine !== engine || checklist.lexicalSources.join() !== lexicalSources.join()) {
    checklist = new Checklist(engine, lexicalSources)
  }
  return checklist
}

/**
 * 接上人工拆解的檢查清單（人工拆解對照用）：第一次用到時載入人工拆解，有的話再載入拆解表。
 * 拆解表載入失敗時拋出錯誤（下次再試）；沒有人工拆解的舊建置照常回傳，對照是 null。
 * @param {{lexicalSources: string[]}} p
 */
async function segmentationChecklist(p) {
  const list = checklistFor(p)
  if (list.segmentationCount() === null) {
    segmentationsLoading ??= fetchJson(/** @type {NonNullable<typeof source>} */ (source), 'search/segmentations.json').catch(() => null)
    const data = await segmentationsLoading
    if (data?.entries?.length && list.engine.morphSearch) await loadParses(list.engine)
    list.attachSegmentations(data)
  }
  return list
}

/** 需要索引就緒的方法 */
const methods = {
  /** @param {{query: string, options?: object}} p */
  search: (p) => requireEngine().search(p.query, p.options),
  /** @param {{query: string, options?: object}} p 句型搜尋（有構詞樣式時先載入拆解表） */
  searchPattern: async (p) => {
    const ready = requireEngine()
    if (ready.needsParseChart(p.query)) await loadParses(ready)
    return ready.searchPattern(p.query, p.options)
  },
  /** @param {{id: string, options?: object}} p */
  neighbors: (p) => requireEngine().neighbors(p.id, p.options),
  /** @param {{id: string}} p */
  docById: (p) => requireEngine().docById(p.id),
  /** @param {object} p 見 babizu/search 的 ListOptions */
  list: (p) => requireEngine().list(p),
  /** @param {{query: string, term: string}} p */
  explainNotes: (p) => requireEngine().explainNotes(p.query, p.term),
  /** @param {{query: string, term?: string | null, options?: object}} p */
  explainMorphology: (p) => requireEngine().explainMorphology(p.query, p.term ?? null, p.options),
  /** @param {{lexicalSources: string[]}} p */
  checklistSummary: (p) => checklistFor(p).summary(),
  /** @param {{lexicalSources: string[], kind?: any, sort?: any, offset?: number, limit?: number}} p */
  checklistTokens: (p) => checklistFor(p).tokenPage(p),
  /** @param {{lexicalSources: string[], filter?: any, offset?: number, limit?: number}} p */
  checklistDuplicates: (p) => checklistFor(p).duplicatePage(p),
  /** @param {{lexicalSources: string[], filter?: any, offset?: number, limit?: number}} p */
  checklistSentences: (p) => checklistFor(p).sentencePage(p),
  /** @param {{lexicalSources: string[], fuzziness?: any, filter?: any, offset?: number, limit?: number}} p 人工拆解對照（沒有時是 null） */
  checklistSegmentations: async (p) => (await segmentationChecklist(p)).segmentationPage(p),
}

/**
 * 載入拆解表並接上引擎（只載一次；失敗時下次再試）。
 * @param {SearchEngine} ready
 */
function loadParses(ready) {
  if (!parsesLoading) {
    parsesLoading = fetchJson(/** @type {NonNullable<typeof source>} */ (source), 'search/parses.json').then((data) => ready.attachParseChart(data))
    parsesLoading.catch(() => (parsesLoading = null))
  }
  return parsesLoading
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
      result = await fn(params)
    }
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
