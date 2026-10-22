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
| `morphology` | `{formType, segmentation, gloss, grammaticalNote?, derivedFrom[]}`；`derivedFrom` 是 `{relation: < > +, text, via, attribution}`。`segmentation` 依萊比錫標註規則（`-` 詞素界、`=` 附著詞界、`~` 重疊、`<x>` 中綴、`( )` 可省略的字母），檢查清單的人工拆解對照拿它與句型搜尋的構詞樣式比 |
| `interlinear[]` | 逐詞對譯 `{form, gloss}` |
| `variants[]` | 變體 `{relation: = ~, text, attribution, dialects, dialectRaw}` |
| `related[]` | 指向其他記錄 `{type, target: 記錄 id}` |
| `group` | `{id, role, parent, seq}`：所屬群組、角色（`head`／`form`／`example`／`segment`／`item`）、原書排在哪筆底下、順序。詞條群組（`type: 'entry'`）的上下層關係也決定搜尋結果的「詞條家族」（見 [search.md](search.md) 第 6 節） |
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

## 不同類型的來源怎麼放

辭典、詞表、長篇語料、田野錄音的結構差很大，但全部放進同一組欄位。差異由三個地方承擔：來源的 `type`、`browse` 與群組的 `type`；
每筆記錄再用 `citation`、`speaker`、`media` 等欄位記下各自的溯源資訊。

| 來源類型 | 來源 `type` | 群組 | 瀏覽（`browse.mode`） | 主要記錄 | 校對（`reviewTracked`） |
|---|---|---|---|---|---|
| 紙本辭典（如 `pazih-dict`） | `dictionary` | 一個詞條一個群組（`entry`），含詞條標題、派生詞與例句 | `page`：一頁一個分片 | 詞綴、詞、片語、句子 | 依來源決定 |
| 分類辭典（如 `kaxabu-classified`） | `dictionary` | 一個語意類別一個群組（`category`） | `category` | 詞、片語 | 依來源決定 |
| 詞表（如 `pan-dexing-wordlist`） | `wordlist` | 依詞性或文獻分組（`list`） | `list` | 詞 | 通常沒有 |
| 語法例句集（如 `lin-grammar`） | `corpus` | 一章一個群組（`list`） | `category` | 句子，附音檔、發音人、記錄日期 | 依來源決定 |
| 錄影、錄音語料（如 `pan-dexing-corpus`） | `corpus` | 一支錄影或錄音一個群組（`recording`） | `recording` | 句子，附時間碼、逐詞對譯 | 依來源決定 |

各種來源特有的資訊放在固定的欄位，不需要另開格式：

| 來源特徵 | 用到的欄位 |
|---|---|
| 田野錄音、錄影語料 | `speaker` 發音人；`media[]` 音檔與影片；`citation.timecode` 起訖秒數；`notes` 記錄日期；群組的 `media[]` 放整支錄影 |
| 紙本辭典 | `citation.page`、`citation.pages[]`、`citation.scan`（原書掃描圖）；`group` 表示詞條的層級 |
| 詞表 | `citation.row`（原表第幾列）；`pos`；`domain`（語意分類） |
| 早期外文文獻 | `dialectRaw`（照抄原始的方言標記）；`attribution`（原書出處）；群組標題放文獻名稱 |
| 使用多種書寫系統的來源 | `altTexts[]`，`text` 仍然是來源的主要寫法 |

校對流程是來源的屬性，不是記錄的屬性：`reviewTracked: false` 的來源，網站完全不顯示校對狀態，不假裝有狀態可言。

## 條目、句子、詞綴與詞根

每筆記錄一個 `unit`：`affix`、`word`、`phrase`、`sentence`（判定規則見上）。詞條、派生詞、例句之間的關係不靠 `unit`，靠群組：

- `group.role`：`head` 詞條標題、`form` 派生詞、`example` 例句、`segment` 語料片段、`item` 一般項目；
- `group.parent`：這筆記錄排在哪一筆底下（記錄 id）。例句的 `parent` 指向它示範的那個詞；
- `morphology.derivedFrom[]`：辭典標示的派生關係 `{relation, text}`，`relation` 是 `<`、`>`、`+`，符號與衍生方式（`via`）依來源體例原樣記錄，不另行詮釋。

以《巴宰語詞典》的 `baket-` 條為例：

```
群組 pazih-dict:p080-16（type: entry，標題 baket-）
├─ head     baket-       affix（formType: bound-initial）     條目標題，是黏著的詞根
├─ form     mubaket      word（formType: free）               派生詞
├─ form     minubaket    word
│   └─ example  mubaket rakihan ki aba    sentence            group.parent → mubaket
└─ …
```

詞根與詞綴的處理：

- `morphology.formType` 分 `free`（自由詞）、`bound-initial`（詞首黏著形式）、`bound-final`（詞尾）、`circumfix`（環綴）、`infix`（中綴）。
  黏著的詞根在辭典裡常寫成 `baket-`，所以與詞綴一樣是 `affix`。
- 資料集**不要求**每筆記錄標出詞根或詞幹。要找詞根，BCDP 用詞庫的所有詞去拆（見 [../packages/bcdp/docs/bcdp.md](../packages/bcdp/docs/bcdp.md)），
  `segmentation` 與 `derivedFrom` 只是辭典已有的人工標註，檢查清單拿它們與演算法的結果對照。
- `segmentation` 依萊比錫標註規則（`-` 詞素界、`=` 附著詞界、`~` 重疊、`<x>` 中綴、`( )` 可省略）。

## 設計原則

1. **照錄，不修正。** `text`、`dialectRaw`、`pos`、`attribution` 都照來源抄；整理過的欄位（`dialects`）另外存。
2. **不確定就留空。** 不臆測方言，不補來源沒有的釋義或英文。
3. **每筆記錄都能溯源。** 頁碼、列號、時間碼、掃描圖，讓人回得到原始位置；`localId` 保持穩定。
4. **校對狀態誠實。** 沒有流程的來源不顯示狀態。
5. **資料與搜尋分開。** 搜尋索引不在資料集裡，換語言設定檔不必重新匯出。
6. **每一筆都驗證。** JSON Schema 加上一致性檢查，有錯誤就不輸出。

## 一致性檢查

`validateDataset` 除了 JSON Schema 之外還檢查：

- 記錄 id、群組 id 全資料集唯一
- 記錄所屬的群組存在於同一分片，`group.parent` 指向存在的記錄
- `dialects` 只使用站台設定的代碼
- `related` 的目標存在（不存在是警告，不是錯誤）

有任何錯誤時 `exportDataset` 不會寫出資料集，`babizu build` 也會停止。
