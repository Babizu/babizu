# 轉接器：把原始資料轉成資料集

每個資料來源由一個**轉接器**負責，把原始格式（試算表、辭典 JSON、字幕、docx…）轉成標準記錄
（見 [data-format.md](data-format.md)）。新增來源不需要修改網站或搜尋引擎。

轉接器通常放在「資料端」的 repo（可以是私有的），和原始資料放在一起；
`exportDataset` 執行所有轉接器後，把資料集寫到網站 repo 的 `data/`。

## 最小的轉接器

```js
// adapters/new-wordlist.js
import { classifyUnit, defineAdapter } from 'babizu/pipeline'
import { readXlsxRows } from 'babizu/pipeline/spreadsheet'
import { createCitation, createGroup, createRecord, createSense } from 'babizu/schema'

const SOURCE_ID = 'new-wordlist' // 小寫英數與連字號

export default defineAdapter({
  source: {
    id: SOURCE_ID,
    title: '新詞表',
    shortTitle: '新詞表',
    type: 'wordlist', // dictionary / wordlist / corpus
    description: '…',
    authors: [],
    year: null, // 不確定就留 null，不要猜
    publisher: null,
    citation: null,
    url: null,
    license: null,
    defaultDialects: ['north'],
    orthography: null,
    browse: { mode: 'list', shardLabel: '部分' }, // page / category / recording / list
    reviewTracked: false, // 這份資料有沒有校對流程？沒有就填 false
    notes: [],
  },

  async load({ input, report, profile }) {
    const [, ...rows] = await readXlsxRows(input) // 第一列是表頭
    const group = createGroup({ source: SOURCE_ID, localId: 'all', type: 'list', title: '全部' })
    const records = []

    for (const { row, cells } of rows) {
      const [text, zh] = cells
      if (!text) {
        report.warn(SOURCE_ID, `第 ${row} 列缺少詞形，略過`)
        continue
      }
      records.push(
        createRecord(
          {
            source: SOURCE_ID,
            localId: `r${row}`,
            unit: classifyUnit(text, { role: 'item' }),
            text,
            citation: createCitation(`新詞表 第 ${row} 列`, { row }),
          },
          {
            dialects: ['north'],
            senses: [createSense({ zh })],
            group: { id: group.id, role: 'item', parent: null, seq: records.length + 1 },
          },
        ),
      )
    }

    return {
      shards: [{ key: 'all', label: '全部', groups: [group], records }],
      // 需要放上網站的檔案：{ kind: 'copy' | 'scan', from: 絕對路徑, to: 'media/…' 或 'scans/…' }
      assets: [],
    }
  },
})
```

`load()` 收到的參數：

| 參數 | 說明 |
|---|---|
| `root` | 資料端 repo 的根目錄 |
| `input` | 這個來源的輸入路徑（絕對路徑） |
| `report` | 警告與錯誤收集器：`report.warn(sourceId, message)`、`report.error(sourceId, message)` |
| `profile` | 站台的語言設定檔。需要比對拼寫時使用，例如 `createTextTools(profile).createSearchMetric()`（`babizu/search`） |

## 匯出

```js
// export.mjs
import { exportDataset } from 'babizu/pipeline'
import newWordlist from './adapters/new-wordlist.js'

const { ok } = await exportDataset({
  sources: [
    { adapter: newWordlist, input: '原始資料/新詞表.xlsx' },
    // 尚未取得公開授權的來源：保留轉接器，但不匯出
    { adapter: restricted, input: '原始資料/受限.xlsx', enabled: false },
  ],
  root: import.meta.dirname,
  outDir: '../my-dictionary/data',
  dialects: ['north', 'south', 'coast'], // 通常從站台設定讀取
  profile, // 語言設定檔，傳給轉接器
  reportFile: '.cache/export-report.json',
})
process.exitCode = ok ? 0 : 1
```

| 選項 | 說明 |
|---|---|
| `sources` | 來源登錄表；順序就是網站上的順序，也是同分結果的次要排序依據 |
| `root` | `input` 的相對基準 |
| `outDir` | 資料集輸出目錄（`records/` 整個重寫，媒體增量同步） |
| `dialects` | 允許的語言變體代碼 |
| `profile` | 語言設定檔 |
| `only` | 只匯出這些來源。**其餘來源會從輸出中消失**，只適合開發時單獨檢查轉接器 |
| `skipScans` | 略過掃描圖轉檔（開發時較快） |
| `reportFile` | 完整的警告與錯誤清單（JSON） |

`enabled: false` 的來源完全不執行，也不會出現在輸出中。有任何錯誤時不會寫出資料集。

媒體與掃描圖：`kind: 'copy'` 直接複製（檔案未變時略過）；`kind: 'scan'` 以 sharp 轉成 WebP（需要安裝 `sharp`）。
匯出最後會清除 `media/`、`scans/` 中不再被任何來源引用的檔案——資料集常放在公開 repo，停用的來源不能留下舊檔。

## 可用的工具

| 模組 | 功能 | 需要安裝 |
|---|---|---|
| `babizu/pipeline/spreadsheet` | `readXlsxRows`、`readCsvRows`（儲存格統一轉為字串，保留原列號）、`isBlank`、`orNull` | `read-excel-file`、`csv-parse` |
| `babizu/pipeline/docx` | `readDocxBody`（依序輸出段落與表格）、`extractInterlinearBlocks`（逐詞對譯文件） | `fflate`、`@xmldom/xmldom` |
| `babizu/pipeline` | `defineAdapter`、`exportDataset`、`Report`、`classifyUnit`、`parseSsa`／`formatTimecode`（字幕） | 轉掃描圖需要 `sharp` |
| `babizu/schema` | `createRecord`、`createGroup`、`createCitation`、`createSense`、`recordId`、`createValidators` | — |

這些解析套件是 babizu 的**選用 peer dependency**：只建網站的 repo 不需要安裝，資料端 repo 依需要自行安裝。

## 撰寫原則

- **不修正原始資料。** 原始拼寫放 `text`；可疑之處寫 `report.warn` 或 `notes`。
- **不臆測。** 作者、年份、方言等不確定的資訊一律留 `null` 或空陣列，並在 `source.notes` 說明。
- **`reviewTracked` 要照實填。** 只有實際有校對流程、狀態代表真實進度的來源才填 `true`。
  對一份沒有校對流程的資料標上紅色的「未校對」，是在告訴讀者一件不存在的事。
- **出處要能回查。** `citation.label` 要讓人看得懂（「《某辭典》p.12，alaw 條」）；
  page、row、code、file、timecode 盡量填，讀者要能靠它們找回原始位置。
- **localId 要穩定。** 同一筆資料重新匯出後編號不能改變，網址與引用都依賴它。優先用來源自己的編號，其次才用列號。
- **需要外部資料時先抓成本機檔案。** 寫一支一次性的工具把資料存進原始資料目錄，轉接器只讀本機檔案，
  匯出才能離線執行、結果可重現。

## 測試

建議為每個轉接器寫整合測試：讀真實的原始檔，檢查每個分片符合 schema、id 唯一、筆數正確，以及幾筆代表性記錄的欄位對應。

```js
import { Report } from 'babizu/pipeline'
import { createValidators, formatErrors } from 'babizu/schema'

const validators = createValidators({ dialects: ['north', 'south', 'coast'] })
const report = new Report()
const output = await adapter.load({ root, input, report, profile })
for (const shard of output.shards) {
  const ok = validators.shard({ source: adapter.source.id, shard: shard.key, label: shard.label, groups: shard.groups, records: shard.records })
  expect(formatErrors(ok ? null : validators.shard.errors)).toEqual([])
}
```
