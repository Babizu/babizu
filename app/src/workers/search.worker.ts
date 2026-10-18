/**
 * @file 搜尋 Web Worker。
 *
 * 在背景執行緒載入索引並執行查詢，避免模糊搜尋阻塞畫面捲動與輸入。
 * 與主執行緒以簡單的訊息協定溝通（見 services/search-client.ts）：
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

import type { PatternSearchOptions } from '@babizu/pattern/search.ts'
import { Checklist, SearchEngine, type Fuzziness, type GroupPageOptions, type ListOptions, type SearchOptions, type SegmentationData, type SegmentationFilter, type TokenKind } from '@babizu/search/index.ts'
import { fetchWithRetry } from '../services/fetch-retry.ts'
import { getFile } from '../playground/db.ts'

/** 資料的位置 */
interface DataSource {
  /** 資料目錄的網址（以 / 結尾） */
  dataBase: string
  /** 建置版本（加在網址上，避免讀到快取的舊檔） */
  version: string
  /** 站台有沒有對應組檢索（有的話一併載入 search/csr.json；實驗性） */
  csr?: boolean
  /** 展示版：資料在 IndexedDB（這個名稱的資料庫）裡，不用網址 */
  playground?: string
}

/** 檢查清單的請求都帶著辭典來源 */
interface ChecklistParams {
  lexicalSources: string[]
}

let engine: SearchEngine | null = null
let loading: Promise<SearchEngine> | null = null
/** 資料的位置（延後載入的檔案用） */
let source: DataSource | null = null
/** 拆解表載入中 */
let parsesLoading: Promise<void> | null = null

async function fetchJson({ dataBase, version, playground }: DataSource, path: string) {
  if (playground) {
    const content = await getFile(playground, version, path)
    if (content === undefined) throw new Error(`Cannot load ${path} from the playground build`)
    return content
  }
  const res = await fetchWithRetry(`${dataBase}${path}?v=${version}`)
  if (!res.ok) throw new Error(`Cannot load ${path} (HTTP ${res.status})`)
  return res.json()
}

async function init({ dataBase, version, csr = false, playground }: DataSource): Promise<{ records: number; terms: number }> {
  if (!loading) {
    source = { dataBase, version, playground }
    const at = source
    loading = (async () => {
      const [docs, lexicon, profile, derivations, model] = await Promise.all([
        fetchJson(at, 'search/docs.json'),
        fetchJson(at, 'search/lexicon.json'),
        fetchJson(at, 'search/language.json'),
        fetchJson(at, 'search/derivations.json'),
        // 對應組檢索的模型載入失敗時照常運作（比對方式退回 BCDP）
        csr ? fetchJson(at, 'search/csr.json').catch(() => null) : null,
      ])
      engine = new SearchEngine({ docs, lexicon, profile, derivations, csr: model })
      engine.warmup()
      return engine
    })()
    loading.catch(() => (loading = null))
  }
  const ready = await loading
  return { records: ready.size, terms: ready.index.size }
}

/** 檢查清單（依辭典來源建立，計算結果留著給下一頁用） */
let checklist: Checklist | null = null
/** 人工拆解（載入失敗時是 null：對照不顯示） */
let segmentationsLoading: Promise<SegmentationData | null> | null = null
function checklistFor({ lexicalSources }: ChecklistParams) {
  const engine = requireEngine()
  if (!checklist || checklist.engine !== engine || checklist.lexicalSources.join() !== lexicalSources.join()) {
    checklist = new Checklist(engine, lexicalSources)
  }
  return checklist
}

/**
 * 接上人工拆解的檢查清單（人工拆解對照用）：第一次用到時載入人工拆解，有的話再載入拆解表。
 * 拆解表載入失敗時拋出錯誤（下次再試）；人工拆解載入失敗時照常回傳，對照是 null。
 */
async function segmentationChecklist(p: ChecklistParams) {
  const list = checklistFor(p)
  if (list.segmentationCount() === null) {
    segmentationsLoading ??= fetchJson(source as NonNullable<typeof source>, 'search/segmentations.json').catch(() => null)
    const data = await segmentationsLoading
    if (data?.entries?.length && list.engine.morphSearch) await loadParses(list.engine)
    list.attachSegmentations(data)
  }
  return list
}

/**
 * 需要索引就緒的方法。主執行緒的 SearchClient 依這張表推出每個方法的參數與回傳型別（WorkerMethods）。
 */
const methods = {
  search: (p: { query: string; options?: SearchOptions }) => requireEngine().search(p.query, p.options),
  /** 句型搜尋（有構詞樣式時先載入拆解表） */
  searchPattern: async (p: { query: string; options?: PatternSearchOptions }) => {
    const ready = requireEngine()
    if (ready.needsParseChart(p.query)) await loadParses(ready)
    return ready.searchPattern(p.query, p.options)
  },
  neighbors: (p: { id: string; options?: { fuzziness?: Fuzziness; limit?: number } }) => requireEngine().neighbors(p.id, p.options),
  docById: (p: { id: string }) => requireEngine().docById(p.id),
  list: (p: ListOptions) => requireEngine().list(p),
  explainNotes: (p: { query: string; term: string }) => requireEngine().explainNotes(p.query, p.term),
  explainMorphology: (p: { query: string; term?: string | null; options?: { fuzziness?: Fuzziness } }) => requireEngine().explainMorphology(p.query, p.term ?? null, p.options),
  checklistSummary: (p: ChecklistParams) => checklistFor(p).summary(),
  checklistTokens: (p: ChecklistParams & { kind?: TokenKind | 'all'; sort?: 'count' | 'text'; offset?: number; limit?: number }) => checklistFor(p).tokenPage(p),
  checklistDuplicates: (p: ChecklistParams & GroupPageOptions) => checklistFor(p).duplicatePage(p),
  checklistSentences: (p: ChecklistParams & GroupPageOptions) => checklistFor(p).sentencePage(p),
  /** 人工拆解對照（沒有人工拆解時是 null） */
  checklistSegmentations: async (p: ChecklistParams & { fuzziness?: Fuzziness; filter?: SegmentationFilter; offset?: number; limit?: number }) =>
    (await segmentationChecklist(p)).segmentationPage(p),
}

/** Worker 的方法表（主執行緒以型別引用） */
export type WorkerMethods = typeof methods & { init: typeof init }

/**
 * 載入拆解表並接上引擎（只載一次；失敗時下次再試）。
 */
function loadParses(ready: SearchEngine): Promise<void> {
  if (!parsesLoading) {
    parsesLoading = fetchJson(source as NonNullable<typeof source>, 'search/parses.json').then((data) => ready.attachParseChart(data))
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
    let result: unknown
    if (method === 'init') {
      result = await init(params)
    } else {
      if (!engine && loading) await loading
      if (!Object.hasOwn(methods, method)) throw new Error(`Unknown method: ${method}`)
      // 參數的型別由主執行緒的 SearchClient 保證（同一張方法表）
      const fn = methods[method as keyof typeof methods] as (p: unknown) => unknown
      result = await fn(params)
    }
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
