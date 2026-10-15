/**
 * @file 轉接器（adapter）介面定義。
 *
 * 每個資料來源一個轉接器，負責把來源的原始格式轉成標準語料（見 babizu/schema 與 docs/data-format.md）。
 * 轉接器只做「格式轉換」，不做語言學修正；有疑問的地方寫進 report 或記錄的 notes／flags。
 *
 * 新增來源的步驟見 docs/adapters.md。
 */

import type { LanguageProfile } from '#bcdp'
import type { CorpusGroup, CorpusRecord, CorpusSource } from '../schema/types.ts'
import type { Report } from './report.ts'

export interface AdapterContext {
  /** 專案根目錄（絕對路徑） */
  root: string
  /** 此來源的輸入路徑（絕對路徑，由資料生產端的來源登錄表設定） */
  input: string
  /** 警告與錯誤收集器 */
  report: Report
  /**
   * 站台的語言設定檔（轉接器需要比對拼寫時用，例如以加權編輯距離核對兩份資料；沒有提供時為 null）
   */
  profile: LanguageProfile | null
}

/** 一個分片（網站按需載入的單位） */
export interface ShardOutput {
  /** 分片鍵，只能含英數字、底線、連字號（用於檔名） */
  key: string
  /** 顯示名稱 */
  label: string
  groups: CorpusGroup[]
  records: CorpusRecord[]
}

/** 需要放到網站上的檔案 */
export interface AssetOutput {
  /** copy 直接複製；scan 轉成 WebP 掃描圖 */
  kind: 'copy' | 'scan'
  /** 來源檔（絕對路徑） */
  from: string
  /** 目的地（相對網站資料根目錄，例如 media/…、scans/…） */
  to: string
}

export interface AdapterOutput {
  shards: ShardOutput[]
  assets: AssetOutput[]
}

export interface SourceAdapter {
  /** 來源後設資料 */
  source: CorpusSource
  load: (ctx: AdapterContext) => Promise<AdapterOutput>
}

/** 定義轉接器（只是回傳原物件，用來取得型別檢查）。 */
export function defineAdapter(adapter: SourceAdapter): SourceAdapter {
  return adapter
}
