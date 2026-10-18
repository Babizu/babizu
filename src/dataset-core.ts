/**
 * @file 標準資料集的型別與不碰檔案的計算（dataset.ts 讀寫檔案；這個檔瀏覽器也能用）。
 */

import type { CorpusGroup, CorpusRecord, CorpusSource } from './schema/types.ts'

export const DATASET_FORMAT = 'babizu-dataset'
export const DATASET_VERSION = 1

export interface DatasetShard {
  /** 分片鍵（檔名） */
  key: string
  /** 顯示名稱 */
  label: string
  groups: CorpusGroup[]
  records: CorpusRecord[]
}

export interface LoadedSource {
  source: CorpusSource
  shards: DatasetShard[]
}

export interface Issue {
  level: 'warn' | 'error'
  source: string
  message: string
}

/** 分片檔的路徑（相對資料集根目錄）。 */
export function shardPath(sourceId: string, shardKey: string): string {
  return `records/${sourceId}/${shardKey}.json`
}

/** 各來源的統計（寫進 sources.json，網站的「資料來源」頁顯示）。 */
export function computeStats(shards: DatasetShard[]): Record<string, number> {
  const stats: Record<string, number> = { records: 0, groups: 0, shards: shards.length, audio: 0, affix: 0, word: 0, phrase: 0, sentence: 0 }
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

/** JSON 一律以兩格縮排、固定鍵序寫出，放進版本管理時 diff 才看得懂 */
const pretty = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`

/**
 * 資料集的 JSON 檔（相對資料集根目錄的路徑 → 內容），依寫出的順序：各分片、sources.json（含統計）、dataset.json。
 * dataset.ts 的 writeDataset 寫成檔案；展示版匯出成壓縮檔。
 */
export function datasetFiles(loaded: LoadedSource[]): Array<[string, string]> {
  const files: Array<[string, string]> = []
  for (const { source, shards } of loaded) {
    for (const shard of shards) {
      files.push([shardPath(source.id, shard.key), pretty({ source: source.id, shard: shard.key, label: shard.label, groups: shard.groups, records: shard.records })])
    }
  }
  files.push(['sources.json', pretty(loaded.map(({ source, shards }) => ({ ...source, stats: computeStats(shards) })))])
  files.push([
    'dataset.json',
    pretty({
      format: DATASET_FORMAT,
      version: DATASET_VERSION,
      sources: loaded.map(({ source, shards }) => ({
        id: source.id,
        shards: shards.map((s) => ({ key: s.key, label: s.label, records: s.records.length, groups: s.groups.length })),
      })),
    }),
  ])
  return files
}
