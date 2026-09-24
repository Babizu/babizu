# 語言設定檔

語言設定檔描述「搜尋時怎麼看待這個語言的拼寫」：哪些字元視為相同、哪些符號忽略、方言之間有哪些系統性的語音對應。
它是純資料（JSON），建置端用它建索引，網站的 Web Worker 用它處理查詢——兩邊讀同一份檔案，搜尋鍵才會一致。

## 完整範例

```json
{
  "format": "babizu-language-profile",
  "version": 1,
  "name": { "zh-TW": "示範語", "en": "Demo language" },
  "normalizer": {
    "lowercase": true,
    "charMap": { "ʔ": "'" },
    "stripDiacritics": true,
    "preserve": ["é"]
  },
  "notationChars": "-=<>…~*",
  "boundaries": [" "],
  "costs": {
    "substitute": 1.5,
    "delete": 1,
    "insert": 0.8,
    "overrides": { " ": { "substitute": 0.1, "delete": 0.1, "insert": 0.1 } }
  },
  "rules": [
    { "category": "流音", "label": { "en": "Liquids" }, "rules": [["r", "l", 0.1]] },
    { "category": "詞尾", "label": { "en": "Word-final" }, "position": "final", "rules": [["n", "ng", 0.1], ["h", "", 0.1]] }
  ]
}
```

## 欄位

### `normalizer` 正規化

比對之前，查詢與詞庫都經過同一套正規化，依序：

1. Unicode NFC
2. `lowercase`（預設 true）：轉小寫
3. `charMap`：逐字元對應。**疊加在框架預設對應之上**（各種撇號 `’ ‘ ʼ ´` → `'`、`ǝ` → `ə`、全形與不斷行空白 → 空白）；
   設 `"useDefaultCharMap": false` 可以不要預設對應。值可以是多個字元（`"ŋ": "ng"`）或空字串（刪除）
4. `stripDiacritics`（預設 false）：去除附加符號；`preserve` 列出的字元例外（例如噶哈巫語的 `é` 是獨立的音位）
5. 連續空白壓成一個、去除頭尾空白

### `notationChars` 體例符號

辭典體例用的符號（詞綴連字號、附著詞等號、中綴括號…），建立搜尋鍵時刪除，但顯示時保留原樣。
預設 `-=<>…~*`。所以 `sikis-`、`ha=ka`、`<in>` 分別可以用 `sikis`、`haka`、`in` 找到。

### `boundaries` 詞邊界

決定規則的「詞首」「詞尾」範圍，預設 `[" "]`。片語中空白前後也算詞尾／詞首，所以 `bintul a ≈ bintun a`。

### `costs` 基本編輯成本

| 欄位 | 預設 | 說明 |
|---|---|---|
| `substitute` | 1.5 | 替換一個字元（相同字元為 0） |
| `delete` | 1.0 | 刪除查詢的字元（查詢多打了） |
| `insert` | 0.8 | 補上候選的字元（查詢少打了） |
| `overrides` | — | 針對單一字元覆寫，例如讓空白的三種操作都只算 0.1，`baruzakbinayu ≈ baruzak binayu` |

插入比刪除便宜，是因為使用者常只記得詞的一部分。所以距離不對稱：`distance(a, b)` 與 `distance(b, a)` 可能不同。

### `rules` 語音對應規則

依分類分組的規則表。每組：

| 欄位 | 說明 |
|---|---|
| `category` | 分類代號，也是預設顯示名稱。演算法實驗室可以整類開關 |
| `label` | 各介面語系的分類名稱，例如 `{ "en": "Word-final" }`；只影響顯示 |
| `description` | 說明（選填） |
| `position` | 整組的位置限制：`any`（預設）、`initial`（詞首）、`final`（詞尾） |
| `rules` | 規則列：`[來源, 目標, 權重]`，或物件 `{ source, target, weight, position?, bidirectional? }` |

規則的語意：

- **多字元對多字元**：`["aru", "aw", 0.1]`
- **一側可以是空字串**：`["r", "", 0.1]` 表示 r 脫落；兩側不能都空
- **預設雙向**：`r → l` 同時註冊 `l → r`；物件列可以設 `"bidirectional": false`
- **位置限制**對兩側都成立：`final` 表示來源片段在查詢的詞尾，**且**目標片段在候選的詞尾
- 權重必須非負（剪枝的正確性依賴這一點）；同一條規則重複出現時取最小權重
- 規則字串也會經過同一套正規化

### 權重怎麼定

- 方言間**系統性**的對應（同一個詞在兩個方言的規則變化）：0.1
- 常見但不規則的對應、拼寫系統之間的差異：0.2–0.3
- 一般替換 1.5、刪除 1.0、插入 0.8，所以一條規則的權重應該遠低於 1，否則等於沒有規則

網站的篩選面板有三段「模糊程度」：精確、標準、寬鬆，對應的距離門檻見 `src/search/engine.js` 的 `FUZZINESS`（門檻隨查詢長度放寬）。
調整規則後，到演算法實驗室（`/lab`）逐格檢查計算過程，比猜權重可靠。

## 驗證

`babizu check` 會檢查結構（`format`、`version`、型別）；規則內容（權重非負、兩側不同時為空）在建立規則集時檢查。

程式中也可以直接使用：

```js
import { createMetricFromProfile, validateProfile } from 'babizu/fuzzy'

validateProfile(profile) // → 錯誤訊息陣列
const metric = createMetricFromProfile(profile)
metric.distance('ralan', 'lalan') // 0.1
metric.explain('ralan', 'lalan') // 完整 DP 表與對齊路徑
```
