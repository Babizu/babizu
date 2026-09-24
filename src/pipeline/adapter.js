/**
 * @file 轉接器（adapter）介面定義。
 *
 * 每個資料來源一個轉接器，負責把來源的原始格式轉成標準語料（見 babizu/schema 與 docs/data-format.md）。
 * 轉接器只做「格式轉換」，不做語言學修正；有疑問的地方寫進 report 或記錄的 notes／flags。
 *
 * 新增來源的步驟見 docs/adapters.md。
 */

/**
 * @typedef {import('../schema/types.js').CorpusRecord} CorpusRecord
 * @typedef {import('../schema/types.js').CorpusGroup} CorpusGroup
 * @typedef {import('../schema/types.js').CorpusSource} CorpusSource
 */

/**
 * @typedef {object} AdapterContext
 * @property {string} root 專案根目錄（絕對路徑）
 * @property {string} input 此來源的輸入路徑（絕對路徑，由資料生產端的來源登錄表設定）
 * @property {import('./report.js').Report} report 警告與錯誤收集器
 * @property {import('../fuzzy/profile.js').LanguageProfile | null} profile 站台的語言設定檔
 *   （轉接器需要比對拼寫時用，例如以加權編輯距離核對兩份資料；沒有提供時為 null）
 */

/**
 * @typedef {object} ShardOutput 一個分片（網站按需載入的單位）
 * @property {string} key 分片鍵，只能含英數字、底線、連字號（用於檔名）
 * @property {string} label 顯示名稱
 * @property {CorpusGroup[]} groups
 * @property {CorpusRecord[]} records
 */

/**
 * @typedef {object} AssetOutput 需要放到網站上的檔案
 * @property {'copy' | 'scan'} kind copy 直接複製；scan 轉成 WebP 掃描圖
 * @property {string} from 來源檔（絕對路徑）
 * @property {string} to 目的地（相對網站資料根目錄，例如 media/…、scans/…）
 */

/**
 * @typedef {object} AdapterOutput
 * @property {ShardOutput[]} shards
 * @property {AssetOutput[]} assets
 */

/**
 * @typedef {object} SourceAdapter
 * @property {CorpusSource} source 來源後設資料
 * @property {(ctx: AdapterContext) => Promise<AdapterOutput>} load
 */

/**
 * 定義轉接器（只是回傳原物件，用來取得編輯器型別提示）。
 * @param {SourceAdapter} adapter
 * @returns {SourceAdapter}
 */
export function defineAdapter(adapter) {
  return adapter
}
