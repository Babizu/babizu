# 加權編輯距離與詞圖搜尋

BCDP 套件（`@babizu/bcdp`，在 babizu 中以 `babizu/fuzzy` 匯出）的基礎：跨方言的加權編輯距離，以及在詞圖上找出距離在上限內的所有詞。
零依賴，瀏覽器與 Node.js 皆可用。構詞搜尋建立在它上面，見 [bcdp.md](bcdp.md)。

文中的例子取自巴宰–噶哈巫語的語言設定檔，但演算法與語言無關：規則、成本、正規化都來自語言設定檔
（babizu 的 [language-profile.md](../../../docs/language-profile.md)）。

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
→ 去除附加符號（保留指定字元，例如噶哈巫語的 `é`）→ 整理空白。規則字串也經過同一個正規化。

babizu 的搜尋端另外刪除辭典體例符號（`notationChars`，預設 `- = < > … ~ *`），見 babizu 的 `src/search/text.ts`。

## 2. 位置限制

規則可以限定位置：

| position | 條件 |
|---|---|
| `any` | 無 |
| `initial` | `s` 位於 X 的詞首，且 `t` 位於 Y 的詞首 |
| `final` | `s` 位於 X 的詞尾，且 `t` 位於 Y 的詞尾 |

「詞首」指前一字元不存在或是邊界字元，「詞尾」指後一字元不存在或是邊界字元；邊界字元預設為空白。所以在片語中也適用：`bintul a ≈ bintun a` 距離 0.1。

構詞音變（`junction: true` 的規則）只在詞素交界適用，見 [bcdp.md](bcdp.md) 1.3 節。

## 3. 詞圖搜尋與「詞尾列」

在詞圖（DAWG，見第 8 節）上做深度優先走訪。深度 j 的節點代表 Y 的前 j 個字元已經確定，於是計算 DP 的第 j 列。共用前綴的詞共用上層的列。

**難點**：規則的 X 側位置條件在查詢時就能確定，Y 側的 `initial` 也只需往回看路徑；但 Y 側的 `final` 要看**下一個字元**，而同一個節點可能有多個子節點，下一個字元不唯一。「到葉節點才重算 final 規則」不夠：

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

實作見 `src/dp.ts` 的 `fillRow(…, allowFinal, …)`。兩字串距離、`explain`、詞圖搜尋都呼叫這同一個函式，保證三者結果一致。

## 4. 剪枝的正確性

所有成本非負，所以沿任何轉移路徑，累積成本單調不減。

**「當前列的最小值超過門檻就剪枝」在有多字元規則時不成立**：像 `aru → aw` 這種 target 長度為 2 的規則，可以從第 j-1 列直接跳到第 j+1 列，越過第 j 列。第 j 列的最小值再大，也不代表子樹沒有答案。

**正確的下界**：令 L 為最長的規則 target 長度。任何通往第 j 列以下的路徑，最後一個「列 ≤ j」的格子一定落在第 j-L+1 … j 列之內，下一步離開到第 j 列以下。分兩種情況：

- 該格在第 j 列：下一步進入某個子節點 c，來源列是 `N_j`（c 非邊界）或 `F_j`（c 是邊界）。成本 ≥ 對應列的最小值。
- 該格在第 r 列（r < j）：下一步必須是一條 target 長度 > j-r 的規則，且 target 的前 j-r 個字元等於路徑上已確定的 `path[r..j)`。成本 ≥ min(第 r 列) + 這類規則的最小權重。

兩者取最小值即為整棵子樹的距離下界。下界大於允許上界時剪枝。

第二種情況的「這類規則的最小權重」是 target trie 上每個真前綴節點的 jump 值，由路徑匹配器逐層提供（6.2 節）。若不檢查前綴、把前 L 列一律納入，下界會太鬆：例如巴宰–噶哈巫語的規則有 `say → tshay`，L = 5，前 5 層幾乎無法剪枝。

**驗證**：`test/fuzzy-index.test.ts` 的性質測試。

- 隨機產生規則（含多字元、空字串、詞首詞尾、單向）、隨機詞庫（含空白）、隨機門檻與正規化策略。
- 檢查詞圖搜尋結果與「對每個詞暴力計算距離」完全相同。
- 「只看當前列」「不區分 N／F」「子節點是邊界時用 N_j」三種錯誤版本，這個測試都會失敗。

## 5. 正規化距離與剪枝

依長度正規化，例如 d / max(|X|, |Y|)，**不滿足三角不等式**（Marzal & Vidal 1993）。這也是不使用 BK-tree、VP-tree 這類度量樹的原因：它們的剪枝依賴三角不等式，會漏掉結果。SymSpell 只處理對稱刪除，無法表達加權的多字元規則。

正規化門檻在詞圖上的處理：每個節點記錄 `height`（子樹中最長詞比本節點多幾個字元）。子樹內候選字串長度 ≤ j + height，把正規化門檻 t 換算成絕對距離上界：

| 策略 | 分數 | 子樹的絕對距離上界 |
|---|---|---|
| `max` | d / max(N, M) | t · max(N, j + height) |
| `sum` | 2d / (N + M) | t · (N + j + height) / 2 |
| `query` | d / N | t · N |

上界對 M 單調不減，所以用子樹最長詞計算出的上界對整棵子樹都成立。正規化分數只在抵達詞尾時計算。

## 6. 規則索引與「每格只剩陣列存取」的實作

遞推式（第 1 節）決定了要算什麼；這一節說明怎麼讓每一格的計算只剩陣列讀取與加法。實作在 `src/dp.ts`，檔頭有逐項說明。

### 6.1 三張表

1. **字元編號**：每個字元給一個小整數（`CompiledRules.idOf`）。規則 target 中的字元最先編號，其他字元（詞庫、查詢）第一次用到時才編號。詞圖每條邊的編號在第一次搜尋時算好並快取。
2. **查詢端的成本表**（`compileQuery`，每個查詢一次）：
   - `del[i]` = del(X[i-1])
   - 對每個候選字元 y 的替換成本列 sub(X[i-1], y)：y 第一次出現時才算，之後共用
   - ins(y)
3. **查詢端的規則表**：source 恰好結束在 X 的位置 i、且 X 側位置條件成立的規則，依 **target 編號**分組，存成平坦陣列（位置、source 長度、權重、initial／final 旗標）。

每一格因此不做任何字串雜湊或 Map 查詢；這是熱迴圈的關鍵。

### 6.2 target trie 與路徑匹配器

計算第 j 列時，要知道「哪些規則的 target 恰好是 Y 在位置 j 結尾的後綴」。所有 target 建成一棵 trie，沿著詞圖路徑逐層維護「可能還在某個 target 中間」的 trie 狀態集合（`PathMatcher`）：

```
states(j) = { child(s, Y[j-1]) : s ∈ states(j-1) ∪ {root} }
```

這就是 Aho–Corasick 自動機的「所有部分匹配」。規則少、target 短（≤ 5），所以直接保留整個集合（每層最多 5 個狀態），比建失敗連結簡單。同一組狀態提供兩種資訊：

- **狀態是某個 target 的結尾**：這個 target 以長度 t = depth(s) 結束在 j，對應規則的來源列是第 j − t 列。
- **狀態還能延伸成更長的 target**：第 r = j − depth(s) 列可以經由更長的規則跳過第 j 列。第 4 節的剪枝下界要加入 min(第 r 列) + jump(s)，其中 jump(s) 是經過 s 的更長 target 的最小權重。

狀態只依賴路徑，與查詢無關，所以多通道搜尋（[bcdp.md](bcdp.md) 第 7 節）中每個詞圖節點只算一次，所有通道共用。

### 6.3 計算一列

`fillRow` 對每個匹配到的 target，先把它的規則轉移整批算進暫存列 `ruleMin`：這些轉移只讀較早的列，與本列的順序無關。主迴圈每格只做插入、替換、刪除三個加法，再比一次 `ruleMin[i]`。

- target 為空字串的脫落規則，來源是同一列較小的 i，所以在主迴圈中依 i 的順序處理。
- 列的最小值在迴圈中順便算出，剪枝不必再掃一次。
- 追蹤模式（explain、演算法實驗室）走另一條較慢的分支，逐一回報候選轉移；兩條分支的每一格都由同一對浮點數相加、取 min，所以值逐位元相同。

## 7. 複雜度

記 L 為最長的 target 長度（巴宰–噶哈巫語為 5），k 為本列匹配到的 target 在 X 中的規則數。

- **每個詞圖節點**：路徑匹配器推進一層，O(L)；所有通道共用。
- **每一列**：O(N + k)。主迴圈每格三個加法、一次比較；規則轉移整批算進暫存列。
- **兩字串距離**：O(N · M + Σk)；**詞圖搜尋**：O(V · (L + N) + Σk)，V 是走訪的節點數，由剪枝決定。

`npm run bench`（babizu 根目錄）以兩萬個假詞與巴宰–噶哈巫語的規則量測詞圖搜尋，回報每種門檻的平均、p95 與走訪節點數。

## 8. 資料結構：DAWG（`src/dawg.ts`）

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

### 記憶體與序列化

DAWG 是幾個 TypedArray（CSR 格式的 `edgeStart`／`edgeTarget`、邊標籤、詞尾旗標），比每個節點一個物件加一個 Map 的 trie
省一到兩個數量級的記憶體（1.2 萬個詞的詞庫約 0.25 MB 對 10 MB）。代價是序列化檔案略大：樹可以用先序走訪隱含表示、
不存指標，圖則必須明確存下每條邊的目標。兩個編碼手段把差距壓到最小：

- 存每個節點的**出邊數**而非 CSR 絕對起點；
- 目標存「本節點編號 − 目標編號」：子節點一定比父節點早登記，差值很小，gzip 壓得好。

詞表陣列（`FuzzyIndex.terms`）只有在真的用到時才由 DAWG 展開。

## 9. API 摘要

```ts
import { createMetricFromProfile, FuzzyIndex, RuleSet, WeightedEditDistance } from '@babizu/bcdp' // babizu 中：'babizu/fuzzy'

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
| `WeightedEditDistance` | `distance`、`normalizedDistance(q, c, 'max' \| 'sum' \| 'query')`、`explain`、`setRules`、`setCosts`（正規化函式不可替換）；同一個查詢對很多候選字串時：`prepareQuery(prepare(q))` 一次，再 `distancePrepared(plan, prepare(c))`；構詞用：`mirror()`（鏡像距離函式）、`explainSegments`（幾個詞素接起來的聯合對齊） |
| `RuleSet` | `add(source, target, weight, { position, bidirectional, category, junction })`、`RuleSet.fromTable(groups)`、`enable`／`disable(category)`、`categories()` |
| `CostModel` | 基本成本與單一字元覆寫 |
| `FuzzyIndex` | `add`、`addAll`、`lookup`、`search`、`searchWithStats`、`searchChannels`、`freeze`、`terms`、`payloads`、`dawg`、`serialize`／`deserialize` |
| `FuzzyIndex.searchChannels(channels)` | 多通道走訪（[bcdp.md](bcdp.md) 第 7 節）；每個通道可帶交界狀態 `from`（起點）、`to`（詞尾耦合）、`onJunction`（回報詞尾的交界狀態）、`lockBoundary`、`cutoff`（共用的相對上限）、`initialFrom`（以某些字元開頭的詞改由另一個交界狀態出發）；`start`／`end` 是沒有跨界表的簡寫 |
| `createNormalizer(options)` | 建立正規化函式；`DEFAULT_CHAR_MAP` 是預設字元對應 |
| `createMetricFromProfile`、`createRulesFromProfile`、`validateProfile` | 由語言設定檔建立 |
| `createAnalyzer(spec, normalize)` | 構詞規格：正規化後的 `spec`、中綴位置與重疊模板（`onset`、`reduplicant`、`reduplicantStems`）、`generate`（由分析還原底層字串）；文法寫法的規格先展開 |
| `expandGrammar(spec, normalize)`、`validateGrammar`、`isGrammarSpec` | 構詞文法（[morph-grammar.md](morph-grammar.md)）：展開成平面清單（每項帶 `parts`、`rank`）、驗證、判斷寫法 |
| `createMorphSearch({ analyzer, metric, index })` | 構詞搜尋 BCDP（[bcdp.md](bcdp.md)）：`search`、`prepare`／`seed`／`finish`（搭配多通道走訪）、`openStems`（字面的開放詞幹，bcdp.md 第 10 節）、`explain`（演算法實驗室）、`notesOf` |
| `virtualRoots`、`virtualRootCost`、`isVirtualRootShape` | 詞庫外的詞根（bcdp.md 第 10 節） |
| `@babizu/bcdp/fst`（babizu 中：`babizu/fst`，實驗性） | 通用 WFST 參考後端：`compose`、`shortestDistance`、`editTransducer`、`surfaceLexicon`、`fstLemmaSearch`；只供評估，不接到網站 |

## 10. 改動 DP 核心時

DP 核心（`dp.ts`、`distance.ts`、`channel-walk.ts`）的效能改動依下面的流程做：

1. **先量測工作量與每單位成本，再下結論**。只比總時間，無法區分「演算法做了較多的工作」與「每單位工作較貴」。
   - 工作量：DP 的格子數、走訪節點數（`searchWithStats` 的 `visitedNodes`、`computedRows`）。
   - 每單位成本：總時間 ÷ 工作量。
   - CPU 剖析：`node --cpu-prof`，依函式的自身時間排序。
2. **只改「怎麼找到候選值」，不改算式**。每一格的候選值仍是同一對浮點數相加，取 min 與順序無關，所以結果可以要求逐位元相同，不必重新驗證正確性。
3. **逐位元快照驗證**：改動前後對同一份資料各產生一次快照比對，涵蓋搜尋回應、構詞搜尋的命中與步驟、詞圖走訪事件（`onNode`）、
   `explain` 的整張 DP 表與候選轉移。先確認快照本身可重現（排除耗時欄位）。babizu 的 `test/golden/` 對示範站台做這件事。
4. **A/B 量測**：改動前的版本另存一份，與改動後在同一個行程中逐查詢交錯執行，每個查詢各跑幾輪取中位數，奇數查詢交換先後順序。
   同一台機器不同時間的量測可以相差 30% 以上，只有交錯執行的比值可信。

## 參考文獻

- Daciuk, Jan, Stoyan Mihov, Bruce W. Watson & Richard E. Watson (2000). Incremental construction of minimal acyclic finite-state automata. _Computational Linguistics_ 26(1).
- Marzal, Andrés & Enrique Vidal (1993). Computation of normalized edit distance and applications. _IEEE TPAMI_ 15(9).
