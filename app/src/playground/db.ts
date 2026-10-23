/**
 * @file 展示版的瀏覽器儲存（IndexedDB）：專案與建置好的網站資料。頁面與 Web Worker 都用這個檔。
 *
 * 兩個 object store：
 * - kv：專案清單、各專案的草稿與已建置的內容（見 projects.ts）、建置的快取清單（'builds'）；
 * - files：網站資料的檔案，鍵是「版本 \0 路徑」（路徑同 `babizu build` 的 data/ 底下）。
 * 資料只存在這台電腦的這個瀏覽器裡；清除網站資料就沒了（工作台可以匯出專案檔）。
 */

const VERSION = 1

/** 保留幾份建置結果（切換回最近用過的專案時不必重建） */
const KEEP_BUILDS = 3

/** 資料庫名稱（依站台代號區分，同一個網域放幾個展示版也不會互相覆蓋） */
export function dbName(siteId: string): string {
  return `${siteId}-playground`
}

const opened = new Map<string, Promise<IDBDatabase>>()

export function openDb(name: string): Promise<IDBDatabase> {
  let db = opened.get(name)
  if (!db) {
    db = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv')
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files')
      }
      req.onsuccess = () => {
        const d = req.result
        // 其他分頁要升級資料庫時讓出連線（下次用到時重新開啟）
        d.onversionchange = () => {
          d.close()
          opened.delete(name)
        }
        resolve(d)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
    })
    db.catch(() => opened.delete(name))
    opened.set(name, db)
  }
  return db
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export async function kvGet<T>(name: string, key: string): Promise<T | undefined> {
  const db = await openDb(name)
  return done(db.transaction('kv').objectStore('kv').get(key)) as Promise<T | undefined>
}

export async function kvSet(name: string, key: string, value: unknown): Promise<void> {
  const db = await openDb(name)
  const tx = db.transaction('kv', 'readwrite')
  tx.objectStore('kv').put(value, key)
  await finished(tx)
}

/**
 * 在同一個交易裡：讀 key、以 update 算出新值寫回，並寫入 puts、刪除 deletes。
 * 讀與寫在同一個交易裡，兩個分頁同時改專案清單也不會互相蓋掉。
 * @param puts 要一起寫入的鍵與值；可以是函式，依 update 的結果決定
 * @returns 寫回的新值
 */
export async function kvUpdate<T>(name: string, key: string, update: (value: T | undefined) => T, puts: Record<string, unknown> | ((value: T) => Record<string, unknown>) = {}, deletes: string[] = []): Promise<T> {
  const db = await openDb(name)
  const tx = db.transaction('kv', 'readwrite')
  const store = tx.objectStore('kv')
  let result: T | undefined
  let failure: unknown
  const req = store.get(key)
  req.onsuccess = () => {
    try {
      result = update(req.result as T | undefined)
      store.put(result, key)
      for (const k of deletes) store.delete(k)
      for (const [k, v] of Object.entries(typeof puts === 'function' ? puts(result) : puts)) store.put(v, k)
    } catch (err) {
      failure = err
      tx.abort()
    }
  }
  try {
    await finished(tx)
  } catch (err) {
    throw failure ?? err
  }
  return result as T
}

const fileKey = (version: string, path: string) => `${version}\u0000${path}`

/** 一份建置結果：專案雜湊 → 資料版本 */
export interface BuildEntry {
  hash: string
  version: string
  /** 最後一次使用的時間（毫秒） */
  used: number
}

/** 找專案雜湊對應的建置結果（檔案還在才算），並記下使用時間 */
export async function findBuild(name: string, hash: string): Promise<string | null> {
  const builds = (await kvGet<BuildEntry[]>(name, 'builds')) ?? []
  const hit = builds.find((b) => b.hash === hash)
  if (!hit || !(await getFile(name, hit.version, 'manifest.json'))) return null
  await kvUpdate<BuildEntry[]>(name, 'builds', (list = []) => list.map((b) => (b.hash === hash ? { ...b, used: Date.now() } : b))).catch(() => {})
  return hit.version
}

/**
 * 存一次建置的所有檔案，記進建置清單，並刪掉清單之外（較久沒用）的版本，免得佔滿空間。
 */
export async function putBuild(name: string, hash: string, version: string, files: Record<string, unknown>): Promise<void> {
  const builds = await kvUpdate<BuildEntry[]>(name, 'builds', (list = []) =>
    [{ hash, version, used: Date.now() }, ...list.filter((b) => b.hash !== hash && b.version !== version)].sort((a, b) => b.used - a.used).slice(0, KEEP_BUILDS),
  )
  const keep = new Set(builds.map((b) => b.version))
  const db = await openDb(name)
  const tx = db.transaction('files', 'readwrite')
  const store = tx.objectStore('files')
  const keys = store.getAllKeys()
  keys.onsuccess = () => {
    for (const key of keys.result as string[]) if (!keep.has(key.slice(0, key.indexOf('\u0000')))) store.delete(key)
    for (const [path, content] of Object.entries(files)) store.put(content, fileKey(version, path))
  }
  await finished(tx)
}

/** 讀一個建置好的檔案（沒有時是 undefined） */
export async function getFile<T>(name: string, version: string, path: string): Promise<T | undefined> {
  const db = await openDb(name)
  return done(db.transaction('files').objectStore('files').get(fileKey(version, path))) as Promise<T | undefined>
}

/** 瀏覽器儲存空間不足的錯誤 */
export function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
}
