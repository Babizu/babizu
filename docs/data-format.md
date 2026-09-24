# 標準資料格式（資料集）

資料集是資料端（轉接器）與網站端（`babizu build`）之間的交換格式。權威定義是
`src/schema/json/*.schema.json`（JSON Schema draft-07），匯出與建置時每一筆都會驗證。

## 目錄結構

```
data/
├── dataset.json                 格式、版本、來源與分片清單（順序即網站上的順序）
├── sources.json                 來源後設資料（CorpusSource[]，含統計）
├── records/<來源>/<分片>.json    { source, shard, label, groups, records }
├── media/…                      音檔、影片
└── scans/…                      原書掃描圖（WebP）
```

- JSON 一律以兩格縮排、固定鍵序寫出，放進版本管理時 diff 看得懂。
- `dataset.json` 的 `format` 是 `"babizu-dataset"`、`version` 是 `1`。
- 搜尋索引**不在**資料集裡：網站建置時由資料集與語言設定檔產生，換語言設定檔不需要重新匯出。
- 用 `readDataset(dir)`、`writeDataset(dir, loaded)`、`validateDataset(loaded, { dialects })`（`babizu/dataset`）讀寫與驗證。

## 三種物件

| 物件 | 說明 |
|---|---|
| **Source** 來源 | 一部辭典、一份詞表或一批語料的後設資料 |
| **Record** 記錄 | 一個詞綴、詞、片語或句子 |
| **Group** 群組 | 有順序的一組記錄：辭典的一個詞條（含派生詞與例句）、一支錄音、一個分類 |

網站按需載入的單位是 **Shard** 分片 `{source, shard, label, groups, records}`：辭典一頁、分類辭典一大類、語料一個場次各是一片。
單一分片建議在 1,000 筆以內（開啟詞條頁時會載入整個分片）。

## Source

不確定的後設資料一律留 `null`，不臆測。

| 欄位 | 說明 |
|---|---|
| `id` | 小寫英數與連字號，例如 `pazih-dict` |
| `title`、`shortTitle` | 全名、簡稱（結果列與出處使用簡稱） |
| `type` | `dictionary`／`wordlist`／`corpus` |
| `description` | 說明，顯示在「資料來源」頁 |
| `authors`、`year`、`publisher`、`citation`、`url`、`license` | 書目資訊；不確定就 `null` |
| `defaultDialects` | 整個來源預設的語言變體；個別記錄可以覆寫 |
| `orthography` | 使用的拼寫系統說明 |
| `browse` | `{mode, shardLabel}`：瀏覽頁的呈現方式（`page`／`category`／`recording`／`list`）與分片的稱呼（「頁」「章」「場次」） |
| `reviewTracked` | **必填。** 這個來源有沒有校對流程。`false` 時網站完全不顯示校對狀態——沒有流程就沒有狀態可言 |
| `notes` | 處理方式與已知限制，顯示在「資料來源」頁 |
| `stats` | 匯出時自動填入，不由轉接器提供 |

## Record

所有欄位一律出現，沒有值時用 `null` 或 `[]`。用 `createRecord()` 建立就會自動補齊。

| 欄位 | 說明 |
|---|---|
| `id` | 全系統唯一：`來源id:localId`，例如 `pazih-dict:p085-01-x01`（`recordId()` 產生） |
| `source`、`localId` | 來源 id；來源內的編號。**localId 要穩定**，網址與引用都依賴它 |
| `unit` | `affix`／`word`／`phrase`／`sentence`（`classifyUnit()` 判定，見下） |
| `text` | **原始拼寫**，照來源抄錄，不修正 |
| `altTexts[]` | 其他書寫系統的寫法 `{system, text}`；`system` 的顯示名稱在站台設定的 `writingSystems` |
| `dialects[]` | 語言變體代碼，**只能用站台設定 `varieties` 列出的代碼**；無法判定時為空 |
| `dialectRaw` | 來源上的原始方言標記，照抄 |
| `senses[]` | `{zh, en, nan, note?}`；`nan` 是臺語 |
| `pos` | 來源上的詞性標記，照抄 |
| `domain` | 語意分類 `{code, label}` |
| `morphology` | `{formType, segmentation, gloss, grammaticalNote?, derivedFrom[]}`；`derivedFrom` 是 `{relation: < > +, text, via, attribution}` |
| `interlinear[]` | 逐詞對譯 `{form, gloss}` |
| `variants[]` | 變體 `{relation: = ~, text, attribution, dialects, dialectRaw}` |
| `related[]` | 指向其他記錄 `{type, target: 記錄 id}` |
| `group` | `{id, role, parent, seq}`：所屬群組、角色（`head`／`form`／`example`／`segment`／`item`）、原書排在哪筆底下、順序 |
| `citation` | 出處 `{label, page, pages[], row, code, file, timecode, scan}`；`label` 要讓人看得懂，其餘欄位讓人找得回原始位置 |
| `media[]` | `{type: audio/video, src, start, end, available, label}`；`src` 相對資料集根目錄 |
| `attribution` | 來源內部標示的原始出處 |
| `speaker` | 講者／發音人 |
| `quality` | `{status, flags[]}`；`status` 三級：`unreviewed`（紅）、`reviewed`（黃）、`verified`（綠） |
| `notes[]` | 其他說明 |

### unit 判定規則

`classifyUnit(text, { role, formType })`（`babizu/pipeline`），依序：

1. 構詞類型是黏著形式，或字形以 `-` 開頭／結尾、形如 `<x>` → `affix`
2. 例句、語料句（role 為 `example`／`segment`）：以 `. ! ?` 結尾或 3 個以上的詞 → `sentence`；2 個詞 → `phrase`；其他 → `word`
3. 其他角色：2 個以上的詞 → `phrase`，否則 `word`

## Group

| 欄位 | 說明 |
|---|---|
| `id`、`source` | `來源id:localId`；來源 id |
| `type` | `entry`（詞條）／`recording`（錄音）／`category`（分類）／`list` |
| `title`、`subtitle` | 顯示名稱 |
| `citation` | 整組的出處（例如錄音檔），可為 `null` |
| `media[]` | 整組的媒體（例如整支錄影），格式同記錄的 `media` |

## 一致性檢查

`validateDataset` 除了 JSON Schema 之外還檢查：

- 記錄 id、群組 id 全資料集唯一
- 記錄所屬的群組存在於同一分片，`group.parent` 指向存在的記錄
- `dialects` 只使用站台設定的代碼
- `related` 的目標存在（不存在是警告，不是錯誤）

有任何錯誤時 `exportDataset` 不會寫出資料集，`babizu build` 也會停止。
