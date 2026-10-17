# 對應組檢索（實驗性）

對應組檢索（correspondence-set retrieval，CSR）是詞條的另一種比對方式：方言之間的語音對應不是人寫的規則，
而是用計算歷史語言學的既有工具（LexStat、對齊、對應模式）**從辭典資料學出來的**；搜尋時以這些對應的機率當作成本，
在動態規劃中比對查詢與詞庫的詞，兩邊都可以先去詞綴。

它與 BCDP（語言設定檔的手寫規則＋構詞搜尋，[search.md](search.md)）是兩種獨立的方法：BCDP 不使用學到的資料，維持可維護、可理解；
對應組檢索是實驗性的備選，由站台決定要不要開放。

## 1. 啟用

站台設定（[site-config.md](site-config.md)）：

```js
export default defineSite({
  // …
  csr: { model: 'language/csr-model.json' },
})
```

- 建置時檢查模型（格式、方言都在 `varieties` 中），複製成網站資料的 `data/search/csr.json`；
- 搜尋篩選出現「比對方式」：**方言規則**（BCDP，預設）／**對應組檢索**（標明「實驗」）；網址上是 `alg=csr`；
- 選了對應組檢索時，**只有詞條**改由它比對；例句與釋義的搜尋不變。查詢含空白（多詞）時詞條照常用 BCDP；
  搜尋方法的篩選（拼寫、部分符合、構詞…）不適用，面板上隱藏；
- 每個結果附「對應組」的說明：把查詢當成哪個方言的詞、兩邊剝了哪些詞綴、詞幹的每個不同處是學到的語音對應還是沒見過的差異、各自的成本；
- 搜尋引擎的 API：`engine.search(q, { algorithm: 'csr' })`，命中的 `matchType` 是 `'csr'`、`csr` 欄是說明（`CsrExplanation`），
  回應的 `algorithm` 是實際用的方法。`new SearchEngine({ …, csr: model })` 載入模型；對應組檢索的詞庫在第一次用到時建立。

## 2. 模型檔

模型只存**計數**，成本由框架在載入時依固定的公式算出（第 3 節），手寫規則也在載入時當作先驗加進去——模型與語言設定檔各管各的。

```json
{
  "format": "babizu-csr-model",
  "version": 1,
  "dialects": ["pazeh", "kaxabu"],
  "segments": ["'", "a", "b", "…", "ng", "ts", "tsh"],
  "patterns": [
    { "reflexes": { "pazeh": "a", "kaxabu": "a" }, "sites": 1217 },
    { "reflexes": { "pazeh": "r", "kaxabu": "-" }, "sites": 112 },
    { "reflexes": { "pazeh": "r", "kaxabu": "l" }, "sites": 62 }
  ],
  "sourceDialects": { "pazih-dict": "pazeh" },
  "params": { "lambda": 3, "typo": 4, "topM": 300, "mergeProbability": 0.7, "beta": 1, "minSites": 2, "priorSites": 2 },
  "levels": { "normal": { "a": 4, "b": 0.6 }, "loose": { "a": 5, "b": 0.8 } },
  "provenance": { "built": "…", "note": "…" }
}
```

| 欄位 | 說明 |
|---|---|
| `dialects` | 學習時的方言（站台 `varieties` 的代碼）。記錄標的是下層變體時算上層的（例如愛蘭算巴宰） |
| `segments` | 音段（書寫層級；多字元的音段也列，切段時最長匹配） |
| `patterns` | 對應組：每個方言的反映形（`-` 是缺口：這個方言沒有對應的音段）與它在對齊的同源詞中出現的欄數。兩個方言時就是段對；兩邊相同的也要列（`a : a`），它們決定「保持不變」的成本 |
| `sourceDialects` | 沒有方言標記的記錄依來源推定方言；沒列的來源當作方言未知（任何方言假設都可以比） |
| `params` | 參數（第 3 節），省略的用預設值 |
| `levels` | 寬鬆程度的門檻（第 3.6 節），省略的用預設值 |
| `provenance` | 學習的出處，框架不讀 |

## 3. 演算法

### 3.1 成本表

對每一對方言 (a, b)——a 是查詢的方言、b 是詞條的方言——數

  c_ab(s, w) ＝ 反映形在 a 是 s、在 b 是 w 的欄數總和（缺口是空字串；只用至少 `minSites` 欄的對應組）

加上**手寫規則的先驗**：語言設定檔每條規則拆成段層級的最少編輯（`aa → a` 是「刪 a」、`aru → aw` 是「刪 r、u 換 w」），
每個編輯兩個方向各加 `priorSites` 欄。成本：

```
s 不是空字串：cost_ab(s → w) ＝ −log((c(s, w) ＋ β·[s = w]) ／ (Σ_w′ c(s, w′) ＋ β))
s 是空字串（b 多出 w）：cost_ab(∅ → w) ＝ −log(c(∅, w) ／ Σ_w′ c(∅, w′))
沒有計數：∞（只能用「打錯」）
```

成本是每一對方言一張表，所以方向（巴宰的 r 對噶哈巫的 ∅，而不是反過來）包含在其中。同一個方言（a ＝ b）的表只有「兩邊相同」（成本 0）。

### 3.2 學出的音類

任何一對方言中 P(w | s) ≥ `mergeProbability` 的兩個音段以 union-find 合併成一類（例如噶哈巫的 o 幾乎總是對巴宰的 u）。
音類只用在第一階段的索引；排序用精細的成本表。

### 3.3 去詞綴

依語言設定檔的構詞規格（構詞文法的 morphemes 或平面清單），列出一個詞所有「剝掉詞綴」的分析：
前綴、後綴；兩個字元以上的中綴（插在第一個輔音之後；一個字元的中綴幾乎任何詞都剝得掉，不用）；
重疊 CV、CVV、Ca、CVCV、CVCVC 中規格有列的；至多兩步、每種至多一次、詞幹至少 `minStem` 個字元。
交界的還原：構詞音變（alternations）在剝掉後綴之後把表面形式換回底層（kabad-an → kabat），前綴也試它套上詞素末構詞音變的寫法（tau' -alaw）；
位置為 initial、一邊是空字串的方言規則（喉塞音的有無）當成交界的增生。這比 BCDP 的構詞搜尋簡單：這裡只要「可能的詞幹」與「剝了幾個詞綴」。

### 3.4 第一階段：取候選

詞庫的每個詞（詞形, 方言）以同樣的方式去詞綴，每個（詞, 詞幹）是一個單位；詞幹以最長匹配切段、換成音類，前後加邊界，
相鄰兩個的二元組建倒排索引。查詢的每個殘餘取共有二元組最多的前 `topM` 個單位（依計數分桶，不必排序）。

### 3.5 第二階段：加權 DP 與分數

每個（查詢殘餘, 候選單位）以成本表做加權編輯距離（tropical 半環）：查詢與詞幹都以「格」表示，所有切法一起比
（`ng` 可以是一段，也可以是 n＋g）；另外容許「打錯」：刪除或插入一個字元各 `typo`（表中沒有的差異也走這裡）。

```
分數 ＝ min over 分析與方言假設 [ 距離_ab(查詢殘餘, 詞條詞幹) ＋ λ ×（兩邊剝掉的詞綴數） ]
```

查詢的方言未知：對每個假設的查詢方言 a 取最好的（包括與詞條同一個方言）。方言未知的詞條也假設方言 b。
λ（`lambda`）是每剝一個詞綴的成本，大約與一個沒見過的差異同一個量級；沒有它時，剝得越多、殘餘越短、距離越小，會過度剝。

### 3.6 寬鬆程度

```
標準：分數 ≤ a ＋ b · n（預設 4 ＋ 0.6n）       n ＝ 查詢的字元數
寬鬆：分數 ≤ a ＋ b · n（預設 5 ＋ 0.8n）
精確：詞幹與查詢完全相同、沒有剝詞綴
```

門檻隨詞長放寬，與 BCDP 的模糊程度同一個形式。預設值在巴宰–噶哈巫語上校準：結果數的中位數與平均不多於 BCDP 同名的等級，其中品質最好的。
**門檻綁著成本的刻度**：學習的資料、λ、`typo`、先驗改了，都要重新校準（第 4 節 步驟 6）。

### 3.7 說明

每個命中的說明：假設的查詢方言與詞條方言、兩邊剝掉的詞綴、詞幹的對齊（DP 回溯；每一步是兩邊相同、學到的對應，還是打錯）。
對齊只為畫面上前幾筆計算。

## 4. 製作模型

學習用 Python 的 [LingPy](https://lingpy.org)（LexStat、對齊）與 LingRex（多個方言時的 CoPaR），在站台之外離線執行；
資料更新時重做一次。**只用可以公開的資料學習。**

1. **詞表**：每一列（方言, 詞義, 詞形）。多數辭典沒有現成的詞表，可以依釋義配對：釋義去掉括號內的說明、依分隔符號切開，
   同一個釋義在兩個方言都有詞的成為一個詞義；任一側超過 3 個詞形的釋義太籠統，不收。LexStat 大約要 200 個詞義以上。
2. **切段與 IPA**：書寫的多字元段以最長匹配切開；送進 LingPy 前換成 IPA（LingPy 的音類模型讀 IPA），學完換回書寫。
3. **同源判斷**：
   ```python
   from lingpy.compare.lexstat import LexStat
   lex = LexStat(rows, segments='tokens', check=False)   # rows[k] = [方言, 詞義, 字串, [段…]]
   lex.get_scorer(runs=1000)                             # 置換法學每對方言的對應分數（先 random.seed，結果才能重現）
   lex.cluster(method='lexstat', threshold=0.6, ref='cogid')
   ```
   門檻沒有真值時，抽一些詞對請懂語言的人判斷。
4. **對齊、修剪、數**：判為同源的每一對詞以 `lex.align_pairs(a, b, method='lexstat', mode='global', pprint=False, return_raw=True)` 對齊；
   從詞的兩端剝掉「連續兩欄以上都有缺口」的段（詞綴般的長度），只有一欄的缺口留下（詞尾的音段脫落是真的對應）；
   數每一欄（a 的段, b 的段），兩邊相同的也數。多於兩個方言時改用多序列對齊與 CoPaR 的對應模式（List 2019）。
5. **寫成模型檔**：`patterns`、`segments`、`dialects`、沒有方言標記的來源的 `sourceDialects`；以 `validateCsrModel` 檢查。
6. **校準寬鬆程度與評估**：以釋義配對當金標準（同一個釋義在另一個方言的詞），詞義分兩半、輪流用一半學習、另一半評估（不洩漏）；
   對每個查詢算出不設門檻的全部結果，在「分數 ≤ a ＋ b·n」的網格上找結果數不超過目標（例如 BCDP 同名等級）、品質最好的 (a, b)，寫進 `levels`。

巴宰–噶哈巫語數位辭典的模型就是這樣做的（兩個方言、851 個詞義、約 950 對同源詞）：釋義配對的評估上，
與 BCDP 結果數相同時，第一個答案的倒數名次平均（MRR）在標準約 0.64 對 0.60、寬鬆約 0.65 對 0.62。

## 5. 參數

| 參數 | 預設 | 說明 |
|---|---|---|
| `lambda` | 3 | 每剝一個詞綴的成本 |
| `typo` | 4 | 表中沒有的差異（打錯、沒見過的對應）：刪除或插入一個字元的成本 |
| `topM` | 300 | 第一階段每個殘餘取幾個候選 |
| `mergeProbability` | 0.7 | 音類合併的門檻 |
| `beta` | 1 | 「兩邊相同」的平滑 |
| `minSites` | 2 | 對應組至少幾欄才用 |
| `priorSites` | 2 | 手寫規則當先驗的欄數（0 時不加） |

## 6. 限制

- 只在一對真實的方言（巴宰–噶哈巫）上驗證過；多方言的優勢在合成資料上看到。
- 去詞綴比 BCDP 的構詞搜尋粗：沒有組合規則、沒有一個字元的中綴、沒有完整重疊；詞綴沒有方言之分。
- 找的是同源詞，不是同義詞：同義而不同源的詞找不到。
- 門檻的數值綁著成本的刻度，換資料或參數要重新校準。

## 7. 文獻

- List, J.-M. 2012. LexStat: Automatic detection of cognates in multilingual wordlists. EACL 2012 Joint Workshop of LINGVIS & UNCLH, 117–125.
- List, J.-M., S. J. Greenhill, R. D. Gray. 2017. The potential of automatic word comparison for historical linguistics. PLOS ONE 12(1): e0170046.
- List, J.-M. 2019. Automatic inference of sound correspondence patterns across multiple languages. Computational Linguistics 45(1): 137–161.
- Blum, F., J.-M. List. 2023. Trimming phonetic alignments improves the inference of sound correspondence patterns from multilingual wordlists. SIGTYP 2023, 52–64.
- Ristad, E. S., P. N. Yianilos. 1998. Learning string edit distance. IEEE TPAMI 20(5).
- 「對應組」（correspondence set）是比較法的傳統術語（Hoenigswald 1960；Anttila 1972）。
