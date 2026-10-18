/**
 * @file 展示版匯出「網站起始包」：把專案變成一個正式的 Babizu 站台需要的檔案（站台設定、語言設定檔、資料集）。
 *
 * 交給網站維護者：放進一個新的站台 repo，`npm install babizu` 之後 `npx babizu build` 就是同一部辭典（docs/getting-started.md）。
 */

import { datasetFiles } from '../dataset-core.ts'
import { projectToDataset, type PlaygroundProject } from './project.ts'

/**
 * 起始包的檔案（路徑 → 內容），依序：README.md、babizu.config.js、language.json、data/…
 * @param siteId 站台代號（小寫英數與連字號）
 */
export function siteStarterFiles(project: PlaygroundProject, siteId = 'my-dictionary'): Array<[string, string]> {
  const json = (v: unknown) => JSON.stringify(v, null, 2)
  const indent = (text: string, n: number) => text.split('\n').join(`\n${' '.repeat(n)}`)
  const config = [
    "import { defineSite } from 'babizu'",
    '',
    '// 由 Babizu 展示版匯出（docs/playground.md）。欄位說明見 babizu 的 docs/site-config.md',
    'export default defineSite({',
    `  id: ${json(siteId)},`,
    "  locales: ['zh-TW', 'en'],",
    `  title: ${indent(json(project.title), 2)},`,
    ...(project.description ? [`  description: ${indent(json(project.description), 2)},`] : []),
    "  language: 'language.json',",
    "  data: 'data',",
    `  varieties: ${indent(json(project.varieties), 2)},`,
    ...(project.examples?.length ? [`  examples: ${indent(json(project.examples), 2)},`] : []),
    ...(project.lab ? [`  lab: ${indent(json(project.lab), 2)},`] : []),
    '})',
    '',
  ].join('\n')
  const readme = [
    `# ${typeof project.title === 'string' ? project.title : (Object.values(project.title)[0] ?? siteId)}`,
    '',
    '由 Babizu 展示版匯出的辭典網站。',
    '',
    '- `babizu.config.js`：站台設定（名稱、語言變體、範例）；',
    '- `language.json`：語言設定檔（方言規則、構詞）；',
    '- `data/`：資料集（詞與例句）。',
    '',
    '建置：在這個目錄 `npm install github:Babizu/babizu`，再 `npx babizu build`（說明見 babizu 的 docs/getting-started.md）。',
    '要換成你自己的原始資料（試算表等）時，改寫一個轉接器產生 data/（docs/adapters.md）。',
    '',
  ].join('\n')
  return [
    ['README.md', readme],
    ['babizu.config.js', config],
    ['language.json', `${json(project.profile)}\n`],
    ...datasetFiles(projectToDataset(project)).map(([path, text]): [string, string] => [`data/${path}`, text]),
  ]
}
