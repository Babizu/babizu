/**
 * @file 標準語料的型別。
 *
 * 權威定義是 json/*.schema.json；這裡是對應的 TypeScript 型別。
 * 站台的程式以 `import type { CorpusRecord } from 'babizu/schema/types'` 引用。
 */

/** 語言變體（方言）代碼，允許的值由站台設定的 varieties 決定 */
export type Dialect = string
export type Unit = 'affix' | 'word' | 'phrase' | 'sentence'
export type GroupRole = 'head' | 'form' | 'example' | 'segment' | 'item'
/** 三級校對狀態 */
export type QualityStatus = 'unreviewed' | 'reviewed' | 'verified'

/** 一個義項 */
export interface Sense {
  /** 中文 */
  zh: string | null
  /** 英文 */
  en: string | null
  /** 臺語 */
  nan: string | null
  note?: string | null
}

/** 其他書寫系統的寫法 */
export interface AltText {
  /** 書寫系統代碼（顯示名稱由站台設定的 writingSystems 或 app/src/lib/labels.js 的 WRITING_SYSTEM_LABELS 提供） */
  system: string
  text: string
}

/** 衍生來源 */
export interface Derivation {
  relation: '<' | '>' | '+'
  text: string
  /** A 同化、M 換位 */
  via?: 'A' | 'M' | null
  attribution?: string | null
}

/** 構詞資訊 */
export interface Morphology {
  formType: 'free' | 'bound-initial' | 'bound-final' | 'circumfix' | 'infix' | null
  /** 分詞形式，例如 ma-des */
  segmentation: string | null
  /** 詞素對譯，例如 狀態-久 */
  gloss: string | null
  /** 語法標記 */
  grammaticalNote?: string | null
  derivedFrom: Derivation[]
}

/** 變體 */
export interface Variant {
  /** `=` 等同（方言讀音）、`~` 或 */
  relation: '=' | '~'
  text: string
  attribution?: string | null
  dialects?: Dialect[]
  dialectRaw?: string | null
}

/** 指向其他記錄的連結 */
export interface RelatedLink {
  type: 'see-also' | 'same-as' | 'derived-from' | 'variant-of'
  /** 目標記錄 id */
  target: string
  label?: string | null
}

/** 記錄在群組中的位置 */
export interface GroupRef {
  /** 群組 id */
  id: string
  role: GroupRole
  /** 原書排在哪一筆底下（記錄 id） */
  parent: string | null
  /** 在群組內的順序 */
  seq: number | null
}

export interface Timecode {
  /** 秒 */
  start: number
  /** 秒 */
  end: number
}

/** 出處（溯源資訊） */
export interface Citation {
  /** 給人看的完整出處說明 */
  label: string
  page: number | null
  pages: number[]
  row: number | null
  code: string | null
  file: string | null
  timecode: Timecode | null
  /** 掃描圖路徑（相對網站資料根目錄） */
  scan: string | null
}

/** 媒體（錄音、影片） */
export interface Media {
  type: 'audio' | 'video'
  src: string | null
  start: number | null
  end: number | null
  available: boolean
  label?: string | null
}

/** 標準語料記錄 */
export interface CorpusRecord {
  id: string
  source: string
  localId: string
  unit: Unit
  text: string
  altTexts: AltText[]
  dialects: Dialect[]
  dialectRaw: string | null
  senses: Sense[]
  pos: string | null
  domain: { code: string; label: string | null } | null
  morphology: Morphology | null
  interlinear: Array<{ form: string; gloss: string }>
  variants: Variant[]
  related: RelatedLink[]
  group: GroupRef | null
  citation: Citation
  media: Media[]
  attribution: string | null
  speaker: string | null
  quality: { status: QualityStatus; flags: string[] }
  notes: string[]
}

/** 記錄群組 */
export interface CorpusGroup {
  id: string
  source: string
  type: 'entry' | 'recording' | 'category' | 'list'
  title: string
  subtitle: string | null
  citation: Citation | null
  media: Media[]
}

/** 資料來源 */
export interface CorpusSource {
  id: string
  title: string
  shortTitle: string
  type: 'dictionary' | 'wordlist' | 'corpus'
  description: string | null
  authors: string[]
  year: string | null
  publisher: string | null
  citation: string | null
  url: string | null
  license: string | null
  defaultDialects: Dialect[]
  orthography: string | null
  browse: { mode: 'page' | 'category' | 'recording' | 'list'; shardLabel: string }
  notes: string[]
  stats?: Record<string, number>
}

/** 資料分片 */
export interface CorpusShard {
  source: string
  shard: string
  label: string
  groups: CorpusGroup[]
  records: CorpusRecord[]
}
