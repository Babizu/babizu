/**
 * @file 展示版的建置：專案 → 網站資料（與 `babizu build` 的 data/ 相同的檔案內容），全部在記憶體中。
 *
 * 用的是 Node 端同一份程式（src/site/site-data.ts）；差別只在：
 * - 資料集由專案轉出（project.ts），不讀檔案；
 * - 自動派生圖的分析方式由呼叫端提供（瀏覽器開幾個 Web Worker，或同一個執行緒）；
 * - 雜湊由呼叫端提供（瀏覽器用 crypto.subtle 的 SHA-1；結果與 Node 的相同）。
 */

import { buildSiteData, computeDerivations, siteManifest, versionInput, type AnalyzeChunks, type SiteData } from '../site/site-data.ts'
import { resolveVarieties } from '../site/varieties.ts'
import { projectToDataset, type PlaygroundProject } from './project.ts'

/** 建置好的網站資料：相對 data/ 的路徑 → 內容（含 manifest.json） */
export interface PlaygroundBuild {
  version: string
  files: Record<string, unknown>
  /** 統計（給畫面顯示） */
  stats: { records: number; terms: number; derivationEdges: number; parses: number }
}

/** 建置的步驟（進度） */
export type BuildStep = 'dataset' | 'index' | 'derivations' | 'done'

/**
 * 建置一個專案的網站資料。
 * @param sha1Hex 字串 → SHA-1 的十六進位（版本與 manifest 的檔案雜湊用）
 * @param analyze 自動派生圖的分析方式（site-data.ts 的 analyzeInProcess，或平行的版本）
 */
export async function buildProject(
  project: PlaygroundProject,
  { sha1Hex, analyze, onStep, builtAt = new Date().toISOString() }: { sha1Hex: (text: string) => Promise<string>; analyze: AnalyzeChunks; onStep?: (step: BuildStep) => void; builtAt?: string },
): Promise<PlaygroundBuild> {
  onStep?.('dataset')
  const errors: string[] = []
  const varieties = resolveVarieties(project.varieties, ['zh-TW'], 'zh-TW', errors)
  if (errors.length) throw new Error(errors.join('\n'))
  const data: SiteData = await buildSiteData(
    { loaded: projectToDataset(project), profile: project.profile, varieties: varieties.map((v) => ({ code: v.code, parent: v.parent })) },
    { derive: (args) => computeDerivations(args, analyze), onStep },
  )
  const files: Record<string, unknown> = {}
  const fileHashes: Record<string, string> = {}
  for (const [path, content] of data.files) {
    files[path] = content
    fileHashes[path] = (await sha1Hex(JSON.stringify(content))).slice(0, 12)
  }
  const version = (await sha1Hex(versionInput(fileHashes))).slice(0, 12)
  files['manifest.json'] = siteManifest(data, { version, fileHashes, builtAt })
  onStep?.('done')
  return {
    version,
    files,
    stats: { records: data.counts.records, terms: data.counts.terms, derivationEdges: data.derivations.data.edges.length / 3, parses: data.derivations.parses.edges.length / 3 },
  }
}
