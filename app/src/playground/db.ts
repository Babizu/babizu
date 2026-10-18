/**
 * @file 展示版的瀏覽器儲存（IndexedDB）：專案與建置好的網站資料。頁面與 Web Worker 都用這個檔。
 *
 * 兩個 object store：
 * - kv：專案（'current' 最後一次建置的、'draft' 工作台正在編輯的）、建置的指標（'build'：專案雜湊 → 資料版本）；
 * - files：網站資料的檔案，鍵是「版本 \0 路徑」（路徑同 `babizu build` 的 data/ 底下）。
 * 資料只存在這台電腦的這個瀏覽器裡；清除網站資料就沒了（工作台可以匯出專案檔）。
 */

const VERSION = 1

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
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
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

export async function kvDelete(name: string, key: string): Promise<void> {
  const db = await openDb(name)
  const tx = db.transaction('kv', 'readwrite')
  tx.objectStore('kv').delete(key)
  await finished(tx)
}

const fileKey = (version: string, path: string) => `${version}\u0000${path}`

/** 存一次建置的所有檔案，並刪掉其他版本的（只留最新的一次建置，免得佔滿空間） */
export async function putBuild(name: string, version: string, files: Record<string, unknown>): Promise<void> {
  const db = await openDb(name)
  const tx = db.transaction('files', 'readwrite')
  const store = tx.objectStore('files')
  store.delete(IDBKeyRange.bound('', `${version}\u0000`, false, true))
  store.delete(IDBKeyRange.lowerBound(`${version}\u0001`))
  for (const [path, content] of Object.entries(files)) store.put(content, fileKey(version, path))
  await finished(tx)
}

/** 讀一個建置好的檔案（沒有時是 undefined） */
export async function getFile<T>(name: string, version: string, path: string): Promise<T | undefined> {
  const db = await openDb(name)
  return done(db.transaction('files').objectStore('files').get(fileKey(version, path))) as Promise<T | undefined>
}
