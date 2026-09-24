# 跨方言模糊搜尋：演算法說明

實作在 `src/fuzzy/`（`babizu/fuzzy`，零依賴，瀏覽器與 Node.js 皆可用）與 `src/search/`（`babizu/search`）。
本文件說明數學定義、正確性論證、效能，以及日後可以怎麼擴充；API 摘要在最後一節。

文中的例子取自巴宰–噶哈巫語的語言設定檔（這個框架最初為它而寫），但演算法本身與語言無關：
規則、成本、正規化都來自各站台的語言設定檔（見 [language-profile.md](language-profile.md)）。
第 3、4 節也修正了常見說法中兩處在實作上不成立的地方。

## 1. 距離的定義

給定查詢字串 X（長度 N）與候選字串 Y（長度 M），兩者都已正規化並拆成 code point。D(i, j) 是把 X 的前 i 個字元轉成 Y 的前 j 個字元的最小成本：

```
D(0, 0) = 0
D(i, j) = min {
  D(i-1, j)       + del(X[i])              刪除（預設 1.0）
  D(i, j-1)       + ins(Y[j])              插入（預設 0.8）
  D(i-1, j-1)     + sub(X[i], Y[j])        替換（預設 1.5，相同字元 0）
  D(i-|s|, j-|t|) + w     對每條規則 s→t：   s 是 X 在 i 結尾的後綴、t 是 Y 在 j 結尾的後綴
}
```

- 空白的插入、刪除、替換成本是 0.1（`CostModel` 的字元覆寫）。
- 規則可以是多字元對多字元（`aru → aw`），`s` 或 `t` 其中一側可以是空字串（`r → ""` 表示 r 脫落），但不能兩側都空。
- 規則預設**自動補反向**（`r → ""` 同時註冊 `"" → r`），所以語音規則對查詢方向是對稱的；只有基本的刪除、插入成本不對稱。
- 所有成本非負，這是剪枝能成立的前提。建立規則與成本時會檢查。

### 正規化

正規化由語言設定檔的 `normalizer` 決定，依序：NFC → 轉小寫 → 逐字元對應（撇號統一、`ǝ`→`ə` 等，加上語言自己的對應）
→ 去除附加符號（保留指定字元，例如噶哈巫語的 `é`）→ 整理空白。

搜尋端（`src/search/text.js`）另外刪除辭典體例符號（`notationChars`，預設 `- = < > … ~ *`）。規則字串也會經過同一個正規化。

## 2. 位置限制

規則可以限定位置：

| position | 條件 |
|---|---|
| `any` | 無 |
| `initial` | `s` 位於 X 的詞首，且 `t` 位於 Y 的詞首 |
| `final` | `s` 位於 X 的詞尾，且 `t` 位於 Y 的詞尾 |

「詞首」指前一字元不存在或是邊界字元，「詞尾」指後一字元不存在或是邊界字元；邊界字元預設為空白。所以在片語中也適用：`bintul a ≈ bintun a` 距離 0.1。

## 3. 詞圖搜尋與「詞尾列」

在詞圖（DAWG，見第 9 節）上做深度優先走訪。深度 j 的節點代表 Y 的前 j 個字元已經確定，於是計算 DP 的第 j 列。共用前綴的詞共用上層的列。

**難點**：規則的 X 側位置條件在查詢時就能確定，Y 側的 `initial` 也只需往回看路徑；但 Y 側的 `final` 要看**下一個字元**，而同一個節點可能有多個子節點，下一個字元不唯一。原分析報告的做法是「到葉節點才重算 final 規則」，這不夠：

1. 詞尾不只出現在葉節點。片語中空白前面也是詞尾，而且這個值會被後面的列引用。
2. final 規則的結果必須參與同一列的後續轉移，例如同列刪除；只在結尾補算一次不正確。

**做法**：每個節點最多計算兩列。

- `N_j`：假設 Y[j+1] 存在且不是邊界，不允許 final 規則
- `F_j`：假設 Y[j+1] 不存在或是邊界，允許 final 規則

使用規則：

- 節點本身是詞尾時，距離取 `F_j[N]`。
- 後面的列引用第 r 列時，依路徑上實際的 Y[r+1] 選用 `F_r` 或 `N_r`，這在往下走時是已知的。
- `F_j` 只在「本節點是詞尾」或「有邊界字元的子節點」時才需要，所以大多數節點只算一列。

詞圖會合併共同後綴，同一個節點可能在走訪中出現在不同位置。這不影響正確性：
DP 的列取決於「走到這裡的路徑」，而深度優先走訪中每條路徑只會走一次。

實作見 `src/fuzzy/dp.js` 的 `fillRow(…, allowFinal, …)`。兩字串距離、`explain`、詞圖搜尋都呼叫這同一個函式，保證三者結果一致。

## 4. 剪枝的正確性

所有成本非負，所以沿任何轉移路徑，累積成本單調不減。

**原報告的說法是「當前列的最小值超過門檻就剪枝」，在有多字元規則時不成立**：像 `aru → aw` 這種 target 長度為 2 的規則，可以從第 j-1 列直接跳到第 j+1 列，越過第 j 列。第 j 列的最小值再大，也不代表子樹沒有答案。

**正確的下界**：令 L 為最長的規則 target 長度。任何通往第 j 列以下的路徑，最後一個「列 ≤ j」的格子一定落在第 j-L+1 … j 列之內，下一步離開到第 j 列以下。分兩種情況：

- 該格在第 j 列：下一步進入某個子節點 c，來源列是 `N_j`（c 非邊界）或 `F_j`（c 是邊界）。成本 ≥ 對應列的最小值。
- 該格在第 r 列（r < j）：下一步必須是一條 target 長度 > j-r 的規則，且 target 的前 j-r 個字元等於路徑上已確定的 `path[r..j)`。成本 ≥ min(第 r 列) + 這類規則的最小權重。

兩者取最小值即為整棵子樹的距離下界。下界大於允許上界時剪枝。

第二種情況用預先建好的雜湊表 `jumpWeights`（規則 target 的每個真前綴 → 最小權重）查詢。若不檢查前綴、把前 L 列一律納入，下界會太鬆：例如巴宰–噶哈巫語的規則有 `say → tshay`，L = 5，前 5 層幾乎無法剪枝。

**驗證**：`test/fuzzy/fuzzy-index.test.js` 的性質測試。

- 隨機產生規則（含多字元、空字串、詞首詞尾、單向）、隨機詞庫（含空白）、隨機門檻與正規化策略。
- 檢查詞圖搜尋結果與「對每個詞暴力計算距離」完全相同。
- 實作時故意改成「只看當前列」「不區分 N／F」「子節點是邊界時用 N_j」三種錯誤版本，這個測試都會失敗。

## 5. 正規化距離與剪枝

依長度正規化，例如 d / max(|X|, |Y|)，**不滿足三角不等式**（Marzal & Vidal 1993）。這也是不使用 BK-tree、VP-tree 這類度量樹的原因：它們的剪枝依賴三角不等式，會漏掉結果。SymSpell 只處理對稱刪除，無法表達加權的多字元規則。

正規化門檻在詞圖上的處理：每個節點記錄 `height`（子樹中最長詞比本節點多幾個字元）。子樹內候選字串長度 ≤ j + height，把正規化門檻 t 換算成絕對距離上界：

| 策略 | 分數 | 子樹的絕對距離上界 |
|---|---|---|
| `max` | d / max(N, M) | t · max(N, j + height) |
| `sum` | 2d / (N + M) | t · (N + j + height) / 2 |
| `query` | d / N | t · N |

上界對 M 單調不減，所以用子樹最長詞計算出的上界對整棵子樹都成立。正規化分數只在抵達詞尾時計算。

## 6. 規則的雜湊索引

每次查詢先建立 `at[i]`：對 X 的每個位置 i，找出所有 source 是「X 在 i 結尾的後綴」且 X 側位置條件成立的規則，以 target 字串分組存成 Map。建立時以 source 字串雜湊查規則，不必掃描全部規則。

計算格子 (i, j) 時，只要拿 Y 在 j 結尾、各個長度的後綴去查 `at[i]`。每個節點的後綴字串只建立一次，同一列的每一格共用。

## 7. 複雜度與實測

- 單一格：O(1 + T + k)。T 是不同 target 長度的個數（巴宰–噶哈巫語的規則為 0、1、2、3、5，共 5 種），k 是匹配到的規則數。
- 兩字串距離：O(N · M · (1 + T + k))。
- 詞圖搜尋：O(V · N · (1 + T + k))，V 是走訪的路徑數，由剪枝決定。

實測（`npm run bench`，2 萬個假詞、7.4 萬個節點，巴宰–噶哈巫語的規則）：

| 門檻 | 平均 | p95 | 平均走訪節點 |
|---|---|---|---|
| maxDistance 0.3 | 1.8 ms | 3.2 ms | 1,095 |
| maxDistance 1 | 7.6 ms | 11.9 ms | 5,143 |
| maxDistance 1.5 | 9.1 ms | 14.9 ms | 5,952 |

巴宰–噶哈巫語數位辭典（14,809 筆記錄、10,702 個詞）上，單詞查詢約 2–12 ms，多詞查詢（每個詞各搜一次）約 40 ms。

## 8. 短查詢與前綴：為什麼還需要另一套索引

加權編輯距離只適合「長度相近、拼寫相近」的兩個詞。實際使用時有兩種需求它天生做不到：

| 使用者輸入 | 期待 | 加權編輯距離的結果 |
|---|---|---|
| `pihi`（只記得詞的開頭） | 找到 `pihilut`「尿」 | 要插入 `lut` 三個字元 ≈ 2.4，遠超過門檻 |
| `k`（想看看哪些詞、句子含有 k） | 列出所有含 k 的詞與句子 | 單一字母與任何詞的距離都很大；正規化門檻也會把長詞全部排除 |

把門檻調高並不能解決：距離門檻一旦放大到 2.4，`bintul` 也會配到幾百個無關的詞，
而且短查詢在「除以較長字串長度」的正規化下永遠吃虧。這是度量本身的性質，不是參數問題。

### 解法：兩種索引各做自己擅長的事

保持加權編輯距離**不變**（它負責跨方言、跨拼寫的相似比對），另外加一個**字元 → 詞**的反向索引，
負責前綴與包含比對。兩者的結果合併後再排序。

```
查詢 → ┬─ 詞圖 + 加權編輯距離 ──→ 模糊命中（含距離與規則說明）
       └─ 字元反向索引 ─────────→ 前綴命中、包含命中
                                    ↓
                        合併、去重，依「模糊 → 前綴 → 包含」分組排序
```

實作在 `src/search/engine.js` 的 `_matchTerms()`：

1. `_fuzzyTerms()`：原本的詞圖搜尋。
2. `_substringTerms()`：取查詢字串中**出現次數最少**的字元，拿它的 posting 當候選集，
   再逐一用 `includes()` 驗證，並分成「以查詢開頭（prefix）」與「包含查詢（substring）」兩類。
   兩類各自依詞長排序（越短代表多出來的部分越少），合計最多取 300 個詞。
3. 兩邊的結果以詞為鍵合併；同一個詞若兩邊都命中，以模糊命中為準（有距離資訊可以顯示規則）。

之後的流程完全共用：詞的 posting 指出它是哪些記錄的詞形、變體、詞根，或出現在哪些句子中，
所以前綴與包含命中同樣會分別出現在「詞條」與「例句」兩區。

### 排序與標示

三種命中方式換算成同一個「等效距離」一起排序（`rankScore()`）：

| 命中方式 | 等效距離 |
|---|---|
| 模糊 | 加權編輯距離本身（完全相同 0、跨方言變體 0.1–0.3） |
| 前綴 | 0.35 ＋ 多出來的字元數 × 0.05 |
| 包含 | 0.90 ＋ 多出來的字元數 × 0.05 |

這組數字讓三種命中互相穿插得合理：

- `bintul`：精確命中（0）與跨方言的 `bintun`（0.1）仍在最前面，前綴命中 `bintulan`（0.45）其次。
- `pihi`：前綴命中 `pihilut`（0.50）排在「拼寫接近但距離較大」的 `pihik-`（0.80）之前——
  使用者打前四個字母時，想找的通常是那個以它開頭的詞。

每一筆結果都標示命中方式（介面上顯示「開頭相符」「包含」），使用者知道自己為什麼會看到這一筆。

### 成本

- 記憶體：字元 → 詞的反向索引，1.2 萬個詞約 8 萬筆 posting，載入後建立約 10 ms。
- 查詢：候選集是「最少見字元」的 posting。最壞情況是查單一常見字母（例如 `a`），
  候選約 8,000 個詞，驗證一次約 1–2 ms；實際查詢在實際辭典上約 2–20 ms。
- 結果量：單字母查詢會命中數百個詞、上千個句子，因此有 300 個詞的上限，
  介面也分頁顯示，並在總數上標明截斷。

### 為什麼不用其他方案

| 方案 | 不採用的原因 |
|---|---|
| 把 maxDistance 調大 | 短查詢會配到大量無關長詞，精確查詢的品質一起崩掉 |
| 在詞圖上做前綴走訪 | 只能解決前綴，解決不了「包含」；而且詞圖已被模糊搜尋使用，混在一起會讓剪枝邏輯難以維護 |
| n-gram 索引（2-gram、3-gram） | 空間大得多，且單一字母查詢仍需另外處理；字元索引 + 驗證已經夠快 |
| 後綴陣列／後綴自動機 | 能做到 O(查詢長度) 的包含比對，但建置與序列化複雜度高出許多，對 1.2 萬個詞的規模不划算 |

## 9. 資料結構：DAWG（`src/fuzzy/dawg.js`）

詞庫用 **DAWG**（有向無環詞圖，即最小化無環有限狀態自動機 MA-FSA）儲存。
Trie 只合併共同前綴，DAWG 進一步合併共同後綴——多數語言都有大量共同詞尾（巴宰–噶哈巫語的 -an、-en、-ay、-ən…），
合併後節點數大幅下降。

### 建構

採 Daciuk et al. (2000) 的漸進式最小化：詞依 code point 字典序加入，每加入一個詞就把
「上一個詞不再需要的尾段」最小化——若登記表中已有等價狀態（詞尾旗標與所有出邊都相同）就直接共用。
因為子節點一定比父節點先登記，節點編號天然是拓撲序（子 < 父），之後計算子樹資訊只要依編號掃一遍。

### 附帶資料：完美雜湊

節點會被多個詞共用，所以 payload 不能掛在節點上。每條邊記錄「這條邊之前有幾個詞」，
沿著詞走一遍把這些數字加起來就得到該詞的字典序名次，用名次索引 payload 陣列。
搜尋時的 DFS 順手累加同一個數字，抵達詞尾時即可取得 payload，沒有額外成本。

### 實測（12,319 個詞的實際詞庫）

| | Trie（Map 版） | DAWG（TypedArray） |
|---|---|---|
| 節點數 | 43,550 | 14,459（另有 24,051 條邊） |
| 記憶體 | 9.81 MB | **0.25 MB** |
| 序列化（gzip） | 約 122 KB | 約 152 KB |
| 查詢速度 | — | 相同（走訪的路徑數不變） |

記憶體差距這麼大，是因為 Map 版 Trie 每個節點都是一個 JS 物件加一個 Map；
DAWG 則是幾個 TypedArray（CSR 格式的 `edgeStart`／`edgeTarget`、邊標籤、詞尾旗標）。

**代價是序列化檔案略大**：樹可以用先序走訪隱含表示、完全不存指標，圖則必須明確存下每條邊的目標。
已用兩個編碼手段把差距壓到最小（以 gzip 後計）：
- 存每個節點的**出邊數**而非 CSR 絕對起點：34 KB → 4 KB
- 目標存「本節點編號 − 目標編號」：子節點一定比父節點早登記，差值中位數只有 7；47 KB → 30 KB

下載多出的約 30 KB，換到執行期少用約 9.5 MB 記憶體，對行動裝置是划算的。
子字串比對需要的詞表陣列（0.44 MB）只有在真的用到時才展開。

### 未來設計

1. **TypedArray＋二進位檔**：邊陣列直接寫成 `.bin`，瀏覽器用 `fetch().arrayBuffer()` 取得，省去 JSON 解析與整數轉字串的膨脹。
2. **Double-Array DAWG**：把圖壓進兩個陣列（BASE／CHECK），可直接 mmap，載入時間接近零。
   `FuzzyIndex` 只依賴「列出出邊、是否為詞尾、height、詞數前綴和」四個操作，換底層時介面不變。

## 10. 詞形還原（lemmatization）的擴充點

`search(query, { expanders })` 接受查詢展開器 `(query) => [{ form, cost, note }]`。搜尋會對每個展開形式再搜一次，距離加上展開成本後合併結果。`src/fuzzy/expanders.js` 附一個示範用的詞綴剝除器（未啟用，詞綴清單不是完整的語言學分析）。

長期可以改用加權有限狀態轉錄器（WFST）：

- **E**：語音規則轉錄器，每條規則是一條加權邊，權重在 tropical semiring 上相加。
- **L**：詞形還原轉錄器，詞形 → 詞根＋詞綴標記。
- 組合 E ∘ L，一次搜尋就同時完成「方言變體 → 標準形 → 詞根」。

標準資料格式已經保留做這件事所需的材料：記錄的 `morphology.derivedFrom`（衍生來源）、
`morphology.segmentation` 與 `interlinear`（分詞形式與詞素對譯）。

索引也已把詞根以 `root` 身分編入 posting，查詞根時會列出所有衍生詞。

## 11. API 摘要

```js
import { createMetricFromProfile, FuzzyIndex, RuleSet, WeightedEditDistance } from 'babizu/fuzzy'

const metric = createMetricFromProfile(profile) // 或 new WeightedEditDistance({ costs, rules, normalize, boundaries })
metric.distance('semer', 'semee') // 0.1
metric.normalizedDistance('semer', 'semee', 'max') // 0.02
metric.explain('semer', 'semee') // { distance, normalized, matrix, candidates, path, alignment, … }

const index = new FuzzyIndex(metric)
index.add('bintun', { id: 'pazih-dict:p087-03' }) // 第二個參數是任意附帶資料
index.search('bintul', { maxDistance: 1 }) // → [{ term: 'bintun', distance: 0.1, score: 0.1, payloads: […] }]
index.searchWithStats('bintul', { maxDistance: 1 }) // 另外回傳 visitedNodes、prunedNodes、computedRows
const data = index.serialize() // FuzzyIndex.deserialize(data, metric)
```

| 類別／函式 | 說明 |
|---|---|
| `WeightedEditDistance` | `distance`、`normalizedDistance(q, c, 'max' \| 'sum' \| 'query')`、`explain`、`setRules`、`setCosts`（正規化函式不可替換） |
| `RuleSet` | `add(source, target, weight, { position, bidirectional, category })`、`RuleSet.fromTable(groups)`、`enable`／`disable(category)`、`categories()` |
| `CostModel` | 基本成本與單一字元覆寫 |
| `FuzzyIndex` | `add`、`addAll`、`lookup`、`search`、`searchWithStats`、`freeze`、`terms`、`payloads`、`dawg`、`serialize`／`deserialize` |
| `createNormalizer(options)` | 建立正規化函式；`DEFAULT_CHAR_MAP` 是預設字元對應 |
| `createMetricFromProfile`、`createRulesFromProfile`、`validateProfile` | 由語言設定檔建立 |

搜尋引擎（`babizu/search`）在此之上處理記錄、斷詞、釋義搜尋與結果排序：

```js
import { buildSearchIndex, SearchEngine } from 'babizu/search'

const { docs, lexicon } = buildSearchIndex({ items, groups, sourceIds, profile, varieties }) // 建置端
const engine = new SearchEngine({ docs, lexicon, profile }) // 瀏覽器（Web Worker）
engine.search('bintul', { fuzziness: 'normal', filters: { dialects: ['pazeh'] } })
```
