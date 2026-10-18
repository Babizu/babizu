/**
 * @file 網站資料的內容（不碰檔案）：資料集＋語言設定檔 → 網站 data/ 底下每個 JSON 檔的內容。
 *
 * Node 端的 prepare.ts 把它們寫成檔案；展示版（docs/playground.md）在瀏覽器裡建置、存進 IndexedDB。
 * 兩邊用同一份程式，內容相同。自動派生圖要對每個詞跑一次構詞搜尋（1 萬個詞約 30 秒），
 * 怎麼分工（Node 的 worker_threads、瀏覽器的 Web Worker、單一執行緒）由呼叫端提供。
 */

import type { LanguageProfile, SerializedIndex } from '#bcdp'
import type { LoadedSource } from '../dataset-core.ts'
import { buildSearchIndex, type BuiltSearchIndex } from '../search/build.ts'
import { createDerivationAnalyzer, encodeDerivations, mergeEdges, type DerivationData, type RangeAnalysis } from '../search/derivations.ts'
import { encodeParses, type ParseData } from '../search/parses.ts'

/** 網站資料格式版本；前端讀到不同版本時會要求重新建置 */
export const SITE_DATA_VERSION = 2

/** 自動派生圖每次分析的詞數：小塊讓各執行緒的工作量平均 */
export const DERIVATION_CHUNK = 250

/** 一段詞編號（自動派生圖的分析單位） */
export interface DerivationChunk {
  from: number
  to: number
}

/** 分析幾段詞（結果依段的順序）；可以平行，結果與單一執行緒相同 */
export type AnalyzeChunks = (args: { lexicon: SerializedIndex; profile: LanguageProfile; chunks: DerivationChunk[] }) => Promise<RangeAnalysis[]>

/** 自動派生圖與拆解表 */
export interface Derivations {
  data: DerivationData
  parses: ParseData
  /** 讀自快取（Node 端） */
  cached?: boolean
}

/**
 * 自動派生圖與拆解表（search/derivations.json、parses.json）。
 * 第 1 階段（詞庫中的詞根、拆解表、虛擬詞根的候選）依段分析；第 2 階段要看全部的邊
 * （詞本身是別的詞的詞根時不往上拆），只過濾候選，在這裡做。
 */
export async function computeDerivations(
  { lexicon, profile, count }: { lexicon: SerializedIndex; profile: LanguageProfile; count: number },
  analyze: AnalyzeChunks,
): Promise<Derivations> {
  if (!profile.morphology) return { data: encodeDerivations([], count), parses: encodeParses([], [], [], count) }
  const chunks: DerivationChunk[] = []
  for (let from = 0; from < count; from += DERIVATION_CHUNK) chunks.push({ from, to: Math.min(count, from + DERIVATION_CHUNK) })
  const results = await analyze({ lexicon, profile, chunks })
  const edges = results.flatMap((r) => r.edges)
  const candidates = results.flatMap((r) => r.virtual)
  const virtual = createDerivationAnalyzer({ lexicon, profile }).virtual(edges, candidates)
  return {
    data: encodeDerivations(mergeEdges(edges, virtual), count),
    parses: encodeParses(
      results.flatMap((r) => r.parses),
      virtual,
      results.flatMap((r) => r.bests),
      count,
    ),
  }
}

/**
 * 在同一個執行緒依序分析（瀏覽器的建置 Worker、測試）。
 * @param onProgress 每分析完一段回報（已完成的詞數、全部的詞數）
 */
export function analyzeInProcess(onProgress?: (done: number, total: number) => void): AnalyzeChunks {
  return async ({ lexicon, profile, chunks }) => {
    const analyzer = createDerivationAnalyzer({ lexicon, profile })
    const total = chunks.length ? chunks[chunks.length - 1].to : 0
    return chunks.map((c) => {
      const result = analyzer.analyzeAll(c.from, c.to)
      onProgress?.(c.to, total)
      return result
    })
  }
}

/** 一個分片的摘要（manifest.json 的 shards） */
export interface ShardSummary {
  key: string
  label: string
  records: number
  groups: number
}

export interface SiteDataInput {
  loaded: LoadedSource[]
  profile: LanguageProfile
  varieties: Array<{ code: string; parent: string | null }>
  /** 對應組檢索的模型（實驗性；沒有時不寫 search/csr.json） */
  csrModel?: unknown
}

/** 網站資料的內容 */
export interface SiteData {
  /** 依寫出的順序：相對 data/ 的路徑 → 內容（manifest.json 除外，它要等檔案的雜湊） */
  files: Array<[string, unknown]>
  /** 來源 → 分片摘要 */
  shards: Record<string, ShardSummary[]>
  sources: string[]
  counts: { records: number; terms: number }
  /** 搜尋索引的統計 */
  index: BuiltSearchIndex['stats']
  derivations: Derivations
}

/**
 * 產生網站資料的內容（manifest.json 除外）。
 * @param derive 自動派生圖與拆解表（通常是 computeDerivations 加上某種分工；Node 端另有快取）
 * @param onStep 進度：'index' 建搜尋索引、'derivations' 建自動派生圖
 */
export async function buildSiteData(
  { loaded, profile, varieties, csrModel }: SiteDataInput,
  { derive, onStep }: { derive: (args: { lexicon: SerializedIndex; profile: LanguageProfile; count: number }) => Promise<Derivations>; onStep?: (step: 'index' | 'derivations') => void },
): Promise<SiteData> {
  const files: Array<[string, unknown]> = []
  const shards: Record<string, ShardSummary[]> = {}
  for (const { source, shards: list } of loaded) {
    shards[source.id] = []
    for (const shard of list) {
      files.push([`records/${source.id}/${shard.key}.json`, { source: source.id, shard: shard.key, label: shard.label, groups: shard.groups, records: shard.records }])
      shards[source.id].push({ key: shard.key, label: shard.label, records: shard.records.length, groups: shard.groups.length })
    }
  }
  files.push(['sources.json', loaded.map((l) => l.source)])

  onStep?.('index')
  const index = buildSearchIndex({
    items: loaded.flatMap(({ shards: list }) => list.flatMap((shard) => shard.records.map((record) => ({ record, shard: shard.key })))),
    groups: loaded.flatMap(({ shards: list }) => list.flatMap((s) => s.groups)),
    sourceIds: loaded.map((l) => l.source.id),
    profile,
    varieties,
  })
  files.push(['search/docs.json', index.docs], ['search/lexicon.json', index.lexicon], ['search/language.json', index.profile], ['search/segmentations.json', index.segmentations])
  if (csrModel) files.push(['search/csr.json', csrModel])

  onStep?.('derivations')
  const derivations = await derive({ lexicon: index.lexicon, profile: index.profile, count: index.stats.terms })
  files.push(['search/derivations.json', derivations.data], ['search/parses.json', derivations.parses])
  return {
    files,
    shards,
    sources: loaded.map((l) => l.source.id),
    counts: { records: index.docs.count, terms: index.stats.terms },
    index: index.stats,
    derivations,
  }
}

/**
 * manifest.json 的內容。
 * @param fileHashes 每個檔的內容雜湊（版本由它們算出，資料一變瀏覽器就會取新檔）
 * @param version 由 fileHashes 算出的版本
 */
export function siteManifest(data: SiteData, { version, fileHashes, builtAt }: { version: string; fileHashes: Record<string, string>; builtAt: string }) {
  return {
    schemaVersion: SITE_DATA_VERSION,
    version,
    builtAt,
    sources: data.sources,
    counts: data.counts,
    shards: data.shards,
    files: fileHashes,
  }
}

/** 版本雜湊的輸入：檔案與雜湊依路徑排序後接起來（Node 與瀏覽器都對它取 SHA-1 的前 12 個十六進位字元） */
export function versionInput(fileHashes: Record<string, string>): string {
  return Object.entries(fileHashes).sort().flat().join('\n')
}
