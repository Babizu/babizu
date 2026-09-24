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

## `morphology` 構詞（選填）

宣告這個語言的詞綴，搜尋就能雙向處理衍生詞：

- **詞根相符**（去詞綴）：查衍生詞，找到詞根。例如查 `mudaux`，得到 `daux`（`mu-` ＋ `daux`）。
- **衍生形**（還原詞綴）：查詞根，找到詞庫與例句中由它衍生的詞，包括中綴形式。例如查 `baket`，得到 `binaket`（`b<in>aket`）。

```json
"morphology": {
  "cost": 0.3,
  "minStem": 3,
  "maxSteps": 3,
  "stemDistance": 0,
  "prefixes": [{ "form": "mu", "gloss": { "zh-TW": "主事焦點", "en": "AF" } }, { "form": "pa" }],
  "suffixes": [{ "form": "an", "gloss": { "zh-TW": "處所焦點", "en": "LF" } }, { "form": "en" }],
  "infixes": [{ "form": "in" }, { "form": "a" }],
  "reduplication": [{ "pattern": "Ca" }],
  "alternations": [{ "underlying": "t", "surface": "d", "before": ["an"] }]
}
```

| 欄位 | 預設 | 說明 |
|---|---|---|
| `cost` | 0.3 | 每個構詞步驟的成本（也可以在個別詞綴上用 `cost` 覆寫）。構詞命中的等效距離是 0.4 ＋ 步驟成本 |
| `minStem` | 3 | 詞幹最短長度，太短的詞幹容易巧合命中 |
| `maxSteps` | 3 | 最多剝除幾層詞綴（前綴常常疊加，例如 `mu-pa-`） |
| `stemDistance` | 0 | 詞根相符時，詞幹允許的加權編輯距離。0 表示詞幹必須正好是詞庫中的詞。設成方言規則的權重（例如 0.1），「另一個方言的衍生詞 → 這個方言的詞根」也找得到，但巧合命中會明顯增加 |
| `vowels` | `aeiouéə` | 元音字母，決定「首輔音」與中綴的位置 |
| `prefixes`、`suffixes` | — | 詞綴清單。`form` 寫成搜尋鍵的形式（不含連字號）；`gloss` 是顯示用的語法說明，可以依語系提供 |
| `infixes` | — | 中綴，插在詞幹首輔音（群）之後、首元音之前；元音開頭的詞幹則插在最前面 |
| `reduplication` | — | 重疊：`Ca`（首輔音＋a）、`CV`（首輔音＋首元音）、`full`（整個詞幹） |
| `alternations` | — | 詞幹交替：詞幹末的 `underlying` 在 `before` 列出的後綴前寫成 `surface`（`bitut` ＋ `-un` → `bitudun`） |

運作方式：

- 分析是有界的列舉：每一層試所有吻合的詞綴，最多 `maxSteps` 層。
  每個分析都保證能用同一份規格還原成原詞形（`generate`），框架的性質測試會檢查。
- **只採用詞庫中存在的詞幹**。規格不必是完整的構詞語法：規格過寬時，多出來的假分析大多因為詞幹不存在而被濾掉。
- 衍生形不必列舉所有詞綴組合。前綴、後綴只加在外面，衍生詞一定含有詞幹的某個「核心形式」
  （詞幹本身，或加了中綴、重疊、交替後的樣子），所以先找含核心形式的詞，再用分析驗證。
- 搜尋索引的格式與大小不變（構詞比對都在查詢時進行）；改了規格只要重新建置網站。
- 精確模式不做構詞比對。

規格可以從資料學出初稿。例如 pazeh-kaxabu 由《巴宰語詞典》標註的 2,141 組「衍生詞 < 詞根」學出詞綴清單，再人工校訂。
程式介面：

```js
import { createAnalyzer } from 'babizu/fuzzy'
const { analyze, generate } = createAnalyzer(profile.morphology)
analyze('binaket') // → [{ stem: 'baket', steps: [{ type: 'infix', form: 'in', … }], cost: 0.3 }, …]
generate('baket', [{ type: 'infix', form: 'in' }]) // → 'binaket'
```

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
