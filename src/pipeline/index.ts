/**
 * @file babizu/pipeline：資料生產端的工具——轉接器介面、匯出資料集、常用解析器。
 *
 * 需要選用套件的解析器放在獨立的子路徑，沒裝那些套件也能引入本模組：
 * - `babizu/pipeline/spreadsheet`：xlsx／csv（需要 read-excel-file、csv-parse）
 * - `babizu/pipeline/docx`：Word 逐詞對譯表（需要 fflate、@xmldom/xmldom）
 * 轉掃描圖需要 sharp，用到時才載入。
 *
 * 寫轉接器的步驟見 docs/adapters.md。
 */

export { defineAdapter, type AdapterContext, type AdapterOutput, type AssetOutput, type ShardOutput, type SourceAdapter } from './adapter.ts'
export { Report } from './report.ts'
export { classifyUnit } from './unit.ts'
export { parseSsa, parseTimecode, formatTimecode, type SsaEvent } from './ssa.ts'
export { ASSET_DIRS, pruneAssets, syncAssets, SCAN_OPTIONS } from './assets.ts'
export { exportDataset, type ExportOptions, type SourceEntry } from './export.ts'
export {
  DATASET_FORMAT,
  DATASET_VERSION,
  computeStats,
  readDataset,
  shardPath,
  validateDataset,
  writeDataset,
  type DatasetShard,
  type Issue,
  type LoadedSource,
} from '../dataset.ts'
