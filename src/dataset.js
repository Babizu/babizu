/**
 * @file 標準資料集（dataset）的讀寫與驗證。
 *
 * 資料集是框架的「交換格式」：資料生產端（轉接器，見 babizu/pipeline）把各種原始資料轉成它，
 * 網站端（babizu build）只讀它。兩端可以放在不同的儲存庫——原始資料可以是私有的，
 * 資料集與網站則公開。
 *
 * ```
 * data/
 * ├── dataset.json                 格式、版本、來源與分片的清單（順序即網站上的順序）
 * ├── sources.json                 來源後設資料（CorpusSource[]，含統計）
 * ├── records/<來源>/<分片>.json    { source, shard, label, groups, records }
 * ├── media/…                      音檔等媒體
 * └── scans/…                      原書掃描圖（WebP）
 * ```
 *
 * JSON 一律以兩格縮排、固定鍵序寫出，放進版本管理時 diff 才看得懂。
 * 完整規格見 docs/data-format.md。
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createValidators, formatErrors } from './schema/index.js'

export const DATASET_FORMAT = 'babizu-dataset'
export const DATASET_VERSION = 1

/**
 * @typedef {import('./schema/types.js').CorpusSource} CorpusSource
 * @typedef {import('./schema/types.js').CorpusRecord} CorpusRecord
 * @typedef {import('./schema/types.js').CorpusGroup} CorpusGroup
 *
 * @typedef {object} DatasetShard
 * @property {string} key 分片鍵（檔名）
 * @property {string} label 顯示名稱
 * @property {CorpusGroup[]} groups
 * @property {CorpusRecord[]} records
 *
 * @typedef {object} LoadedSource
 * @property {CorpusSource} source
 * @property {DatasetShard[]} shards
 *
 * @typedef {object} Issue
 * @property {'warn' | 'error'} level
 * @property {string} source
 * @property {string} message
 */

/**
 * 分片檔的路徑（相對資料集根目錄）。
 * @param {string} sourceId
 * @param {string} shardKey
 */
export function shardPath(sourceId, shardKey) {
  return `records/${sourceId}/${shardKey}.json`
}

/**
 * 各來源的統計（寫進 sources.json，網站的「資料來源」頁顯示）。
 * @param {DatasetShard[]} shards
 * @returns {Record<string, number>}
 */
export function computeStats(shards) {
  /** @type {Record<string, number>} */
  const stats = { records: 0, groups: 0, shards: shards.length, audio: 0, affix: 0, word: 0, phrase: 0, sentence: 0 }
  for (const shard of shards) {
    stats.groups += shard.groups.length
    for (const r of shard.records) {
      stats.records++
      stats[r.unit]++
      if (r.media.some((m) => m.type === 'audio' && m.available)) stats.audio++
    }
  }
  return stats
}

/**
 * 以 schema 驗證來源與分片，並做全域一致性檢查
 * （記錄 id 唯一、群組存在、parent 存在、related 目標存在）。
 *
 * @param {LoadedSource[]} loaded
 * @param {{dialects?: string[]}} [options] `dialects`：允許的語言變體代碼（來自站台設定）
 * @returns {Issue[]}
 */
export function validateDataset(loaded, { dialects } = {}) {
  const validators = createValidators({ dialects })
  /** @type {Issue[]} */
  const issues = []
  const error = (/** @type {string} */ source, /** @type {string} */ message) => issues.push({ level: 'error', source, message })
  const warn = (/** @type {string} */ source, /** @type {string} */ message) => issues.push({ level: 'warn', source, message })

  for (const { source, shards } of loaded) {
    if (!validators.source(source)) {
      for (const msg of formatErrors(validators.source.errors, `來源 ${source.id}`)) error(source.id, msg)
    }
    for (const shard of shards) {
      const data = { source: source.id, shard: shard.key, label: shard.label, groups: shard.groups, records: shard.records }
      if (!validators.shard(data)) {
        // 同一個錯誤常會在上千筆記錄重複出現，每個分片只列前 20 則
        for (const msg of formatErrors(validators.shard.errors, `${source.id}/${shard.key}`).slice(0, 20)) {
          error(source.id, msg)
        }
      }
    }
  }

  /** @type {Set<string>} */
  const ids = new Set()
  /** @type {Set<string>} */
  const groupIds = new Set()
  for (const { source, shards } of loaded) {
    for (const shard of shards) {
      for (const g of shard.groups) {
        if (groupIds.has(g.id)) error(source.id, `群組 id 重複：${g.id}`)
        groupIds.add(g.id)
      }
      for (const r of shard.records) {
        if (ids.has(r.id)) error(source.id, `記錄 id 重複：${r.id}`)
        ids.add(r.id)
      }
    }
  }
  for (const { source, shards } of loaded) {
    for (const shard of shards) {
      for (const r of shard.records) {
        if (r.group && !groupIds.has(r.group.id)) error(source.id, `${r.id}：所屬群組 ${r.group.id} 不存在`)
        if (r.group?.parent && !ids.has(r.group.parent)) error(source.id, `${r.id}：parent ${r.group.parent} 不存在`)
        for (const link of r.related) {
          if (!ids.has(link.target)) warn(source.id, `${r.id}：related 目標 ${link.target} 不存在`)
        }
      }
    }
  }
  return issues
}

/** @param {unknown} data */
const pretty = (data) => `${JSON.stringify(data, null, 2)}\n`

/**
 * 寫出資料集的 JSON 部分（dataset.json、sources.json、records/）。媒體與掃描圖由 syncAssets 處理。
 * 會先清空 records/，所以移除的來源或分片不會殘留。
 *
 * @param {string} dir 資料集根目錄
 * @param {LoadedSource[]} loaded
 */
export async function writeDataset(dir, loaded) {
  await rm(join(dir, 'records'), { recursive: true, force: true })
  for (const { source, shards } of loaded) {
    for (const shard of shards) {
      const path = join(dir, shardPath(source.id, shard.key))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(
        path,
        pretty({ source: source.id, shard: shard.key, label: shard.label, groups: shard.groups, records: shard.records }),
      )
    }
  }
  const sources = loaded.map(({ source, shards }) => ({ ...source, stats: computeStats(shards) }))
  await writeFile(join(dir, 'sources.json'), pretty(sources))
  await writeFile(
    join(dir, 'dataset.json'),
    pretty({
      format: DATASET_FORMAT,
      version: DATASET_VERSION,
      sources: loaded.map(({ source, shards }) => ({
        id: source.id,
        shards: shards.map((s) => ({ key: s.key, label: s.label, records: s.records.length, groups: s.groups.length })),
      })),
    }),
  )
}

/**
 * 讀取資料集。
 * @param {string} dir 資料集根目錄
 * @returns {Promise<LoadedSource[]>}
 */
export async function readDataset(dir) {
  /** @param {string} name */
  const read = async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'))
  let manifest
  try {
    manifest = await read('dataset.json')
  } catch (e) {
    throw new Error(`找不到資料集 ${join(dir, 'dataset.json')}。資料集由資料生產端匯出（見 docs/data-format.md）`, {
      cause: e,
    })
  }
  if (manifest.format !== DATASET_FORMAT) throw new Error(`${dir} 不是 babizu 資料集（format 應為 ${DATASET_FORMAT}）`)
  if (manifest.version !== DATASET_VERSION) {
    throw new Error(`資料集版本 ${manifest.version} 與框架支援的版本 ${DATASET_VERSION} 不符`)
  }
  /** @type {CorpusSource[]} */
  const sources = await read('sources.json')
  const byId = new Map(sources.map((s) => [s.id, s]))
  /** @type {LoadedSource[]} */
  const loaded = []
  for (const entry of manifest.sources) {
    const source = byId.get(entry.id)
    if (!source) throw new Error(`dataset.json 列出的來源 ${entry.id} 不在 sources.json 中`)
    const shards = []
    for (const { key } of entry.shards) {
      const data = await read(shardPath(entry.id, key))
      shards.push({ key: data.shard, label: data.label, groups: data.groups, records: data.records })
    }
    loaded.push({ source, shards })
  }
  return loaded
}
