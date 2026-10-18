/**
 * @file 送進瀏覽器的站台設定（前端的虛擬模組 `virtual:babizu/site`）的型別。
 *
 * 只有型別、不引用任何 Node 模組：前端（app/）的型別檢查也引用這個檔。
 * 內容由 config.ts 的 loadSiteConfig 產生，必須可以 JSON 序列化。
 */

import type { LanguageProfile } from '#bcdp'

/** 一組前景與背景顏色（CSS 色值） */
export interface ColorPair {
  fg: string
  bg: string
}

/** 解析後的語言變體 */
export interface ResolvedVariety {
  code: string
  parent: string | null
  label: Record<string, string>
  colors: { light: ColorPair; dark: ColorPair }
}

/** 依語系攤開的文字（語系 → 文字） */
export type LocalizedText = Record<string, string>

/** 一個搜尋範例 */
export interface ClientExample {
  q: string
  note: LocalizedText | null
}

export interface ClientSite {
  /** 站台代號（瀏覽器儲存空間的前綴） */
  id: string
  locales: string[]
  defaultLocale: string
  localeNames: Record<string, string>
  title: LocalizedText
  shortTitle: LocalizedText | null
  description: LocalizedText | null
  footer: LocalizedText | null
  /** 站徽檔名（public 目錄中有這個檔時） */
  icon: string | null
  themeColor: string
  varieties: ResolvedVariety[]
  /** 書寫系統代碼 → 顯示名稱 */
  writingSystems: Record<string, LocalizedText | null>
  /** 輸入法列出的特殊字元 */
  specialChars: string[]
  examples: ClientExample[]
  patternExamples: ClientExample[]
  /** 「關於」頁（語系 → HTML） */
  about: LocalizedText | null
  /** 演算法實驗室的預設輸入 */
  lab: {
    pairs: Array<[string, string]>
    words: string | null
    morph: { examples: Array<[string, string]>; failures: Array<[string, string]> }
  }
  /** 介面字串：語系 → 中文原文 → 譯文 */
  messages: Record<string, Record<string, string>>
  /** 語言設定檔 */
  profile: LanguageProfile
  /** 有沒有對應組檢索（實驗性；模型在網站資料的 search/csr.json） */
  csr: boolean
  /**
   * 展示版（docs/playground.md）：資料不是建置好的檔案，而是瀏覽器裡的專案；
   * 這時站台設定在載入時由專案產生（app/src/playground/runtime.ts），多一個「工作台」頁
   */
  playground: boolean
}
