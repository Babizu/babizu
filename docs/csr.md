# 對應組檢索（實驗性）

對應組檢索（correspondence-set retrieval，CSR）是模糊搜尋的另一個核心演算法。

- **語音對應從資料學出，不是人寫的規則**：方言之間的語音對應，用計算歷史語言學的既有工具（LexStat、對齊）從辭典資料學出；
  框架不讀語言設定檔的方言規則。仍然由人寫的部分見第 6 節。
- **對應可以看前後文**：例如「u 在 h 之前才對到 o」「只在詞尾 l 對到 n」。
- **搜尋時**：以這些對應的機率當作成本，在動態規劃中比對查詢與詞庫的詞，兩邊都可以先去詞綴。
- **只換一層**：它只換「一個查詢詞找到哪些詞庫詞」，搜尋條件、命中方式、詞條與例句的呈現都與 BCDP 相同。

它與 BCDP（[search.md](search.md)）是兩種獨立的方法：
- BCDP 用語言設定檔的手寫規則與構詞搜尋，不使用學到的資料，維持可維護、可理解；
- 對應組檢索是實驗性的備選，由站台決定要不要開放。

## 1. 啟用

站台設定（[site-config.md](site-config.md)）：

```js
export default defineSite({
  // …
  csr: { model: 'language/csr-model.json' },
})
```

- 建置時檢查模型（格式、方言都在 `varieties` 中），複製成網站資料的 `data/search/csr.json`。
- 右上角的設定選單多「模糊搜尋」一項：**方言規則**（BCDP，預設）／**對應組檢索**（標明「實驗」）。
  這是讀者的偏好，和外觀、介面語言一樣存在瀏覽器裡（鍵 `<站台代號>:algorithm`），不寫在網址上。
- **搜尋條件與結果的呈現不變**：模糊程度、搜尋方法的篩選與筆數、詞條與例句、辭典標註的構詞關係、開頭／結尾相符與包含都照舊。
  對應組檢索取代的是 BCDP 的模糊比對與構詞搜尋（自動拆解、自動派生、自動同根），它的分析對到同樣的命中方式：

  | 對應組檢索的分析 | 命中方式 |
  |---|---|
  | 兩邊都沒有剝詞綴 | 相近拼寫（同一個詞是完全相符） |
  | 只剝了查詢的詞綴 | 自動拆解：查詢去詞綴之後是這個詞 |
  | 只剝了詞庫詞的詞綴 | 自動派生：這個詞是查詢加上詞綴 |
  | 兩邊都剝 | 自動同根：兩者推定來自同一個詞幹 |

  分數乘上 `scoreScale` 換算成 BCDP 的刻度，與開頭相符、包含、辭典的構詞關係放在一起排序。
- 結果的標籤與 BCDP 的一樣（「≈ 距離」、「自動拆解 mu- + pana」）；點開的說明是對應組檢索自己的（第 3.8 節）。
- 多詞的查詢：每個詞各自以對應組檢索比對（例句照常要求每個詞都出現）；整個查詢含空白時，詞條中的片語照常用 BCDP。
- 搜尋引擎的 API：
  - `engine.search(q, { algorithm: 'csr' })`：命中的 `csr` 欄是說明（`CsrExplanation`），回應的 `algorithm` 是實際用的方法（沒有模型時是 `bcdp`）；
  - `new SearchEngine({ …, csr: model })` 載入模型。對應組檢索的詞庫（詞圖的所有詞）在第一次用到時建立，巴宰–噶哈巫語約 0.5 秒。

## 2. 模型檔

模型只存**計數**，成本由框架在載入時依固定的公式算出（第 3 節）。

```json
{
  "format": "babizu-csr-model",
  "version": 1,
  "dialects": ["pazeh", "kaxabu"],
  "segments": ["'", "a", "b", "…", "ng", "ts", "tsh"],
  "patterns": [
    { "reflexes": { "pazeh": "a", "kaxabu": "a" }, "sites": 1152 },
    { "reflexes": { "pazeh": "r", "kaxabu": "-" }, "sites": 112 },
    { "reflexes": { "pazeh": "uh", "kaxabu": "oh" }, "sites": 15 },
    { "reflexes": { "pazeh": "l", "kaxabu": "n" }, "sites": 32, "position": "final" },
    { "reflexes": { "pazeh": "ura", "kaxabu": "owa" }, "sites": 3, "of": { "pazeh": 52, "kaxabu": 3 } }
  ],
  "occurrences": { "pazeh": { "uh": 27, "l$": 34 }, "kaxabu": { "oh": 19, "n$": 121 } },
  "sourceDialects": { "pazih-dict": "pazeh" },
  "params": { "lambda": 3, "typo": 4, "topM": 300, "mergeProbability": 0.7, "beta": 1, "minSites": 2, "scoreScale": 0.2 },
  "levels": { "normal": { "a": 4, "b": 0.6 }, "loose": { "a": 5, "b": 0.8 } },
  "provenance": { "built": "…", "note": "…" }
}
```

| 欄位 | 說明 |
|---|---|
| `dialects` | 學習時的方言（站台 `varieties` 的代碼）。記錄標的是下層變體時算上層的（例如愛蘭算巴宰） |
| `segments` | 音段（書寫層級；多字元的音段也列，切段時最長匹配） |
| `patterns` | 對應組，見下表 |
| `occurrences` | 前後文單位的來源字串在對齊資料中出現幾次（方言 → 鍵 → 次數），當作成本的分母。鍵是字串本身，詞首的前面加 `^`、詞尾的後面加 `$`，空字串是「可以插入的位置」數。只是短字串的計數，沒有詞形 |
| `sourceDialects` | 沒有方言標記的記錄依來源推定方言；沒列的來源當作方言未知（任何方言假設都可以比） |
| `params` | 參數（第 7 節），省略的用預設值 |
| `levels` | 寬鬆程度的門檻（第 3.7 節），省略的用預設值 |
| `provenance` | 學習的出處，框架不讀 |

對應組（`patterns` 的每一項）有兩種：

| 種類 | 反映形 | 其他欄位 |
|---|---|---|
| **單一音段** | 每個方言是一個音段或 `-`（缺口：這個方言沒有對應的音段） | `sites` 是它在對齊的同源詞中出現的欄數。兩邊相同的也要列（`a : a`），它們決定「保持不變」的成本 |
| **前後文單位** | 幾個音段連寫（`uh : oh`：u 在 h 之前才對到 o），或單一音段加上 `position`（`initial`、`final`：只在詞首或詞尾成立） | `sites` 是它出現的次數；分母是 `occurrences` 中來源字串的次數。`of`（方言 → 次數）可以取代 `occurrences`：以元音類合併的家族（第 5 節）每個成員的 `sites` 與分母都是整個家族的 |

## 3. 演算法

### 3.1 單一音段的成本表

對每一對方言 (a, b)——a 是查詢的方言、b 是詞條的方言——數

  c_ab(s, w) ＝ 反映形在 a 是 s、在 b 是 w 的欄數總和（缺口是空字串；只用至少 `minSites` 欄的對應組）

成本：

```
s 不是空字串：cost_ab(s → w) ＝ −log((c(s, w) ＋ β·[s = w]) ／ (Σ_w′ c(s, w′) ＋ β))
s 是空字串（b 多出 w）：cost_ab(∅ → w) ＝ −log(c(∅, w) ／ Σ_w′ c(∅, w′))
沒有計數：∞（只能用「打錯」）
```

成本是每一對方言一張表，所以方向（巴宰的 r 對噶哈巫的 ∅，而不是反過來）包含在其中。同一個方言（a ＝ b）的表只有「兩邊相同」（成本 0）。

### 3.2 前後文單位

單一音段的成本不看前後文。例如 maturay 對 matoway，逐欄看是 u → o 與 r → w，兩者都會被算成到處都成立的對應。
前後文單位是「一整段一起換」：a 方言的字串 x 對到 b 方言的字串 y，可以限定在詞首或詞尾。

```
cost_ab(x → y) ＝ −log(c(x, y) ／ n_a(x))      n_a(x)：x 在 a 方言的對齊資料中出現的次數（occurrences 或 of）
```

- DP 中查詢在 i 開頭是 x、詞條在 j 開頭是 y 時，才能整段跳過；兩邊都要符合，單獨的 u → o 仍是單一音段的成本。
- 有位置的單位要貼齊頭或尾；剝了詞綴之後，指的是詞幹的頭尾。
- 學習時，前後文單位出現處的欄已經從單一音段的計數拿掉（「解釋掉」，第 5 節）。
  所以只出現在某個前後文中的對應，不會再當成到處都成立的對應。
- 同一個方言沒有前後文單位。

### 3.3 學出的音類

任何一對方言中 P(w | s) ≥ `mergeProbability` 的兩個音段以 union-find 合併成一類（例如噶哈巫的 o 幾乎總是對巴宰的 u）。
音類只用在第一階段的索引；排序用精細的成本。

### 3.4 去詞綴

依語言設定檔的構詞規格（構詞文法的 morphemes 或平面清單），列出一個詞所有「剝掉詞綴」的分析：
- 前綴、後綴；
- 兩個字元以上的中綴（插在第一個輔音之後；一個字元的中綴幾乎任何詞都剝得掉，不用）；
- 重疊 CV、CVV、Ca、CVCV、CVCVC 中規格有列的；
- 至多兩步、每種至多一次、詞幹至少 `minStem` 個字元。

交界的還原：構詞音變（alternations）在剝掉後綴之後把表面形式換回底層（kabad-an → kabat），前綴也試它套上詞素末構詞音變的寫法（tau' -alaw）。
這比 BCDP 的構詞搜尋簡單：這裡只要「可能的詞幹」與「剝了幾個詞綴」。**詞綴清單與構詞音變是人寫的**（第 6 節）。

### 3.5 第一階段：取候選

1. 詞庫的每個詞（詞形, 方言）以同樣的方式去詞綴，每個（詞, 詞幹）是一個單位。
2. 詞幹以最長匹配切段、換成音類，前後加邊界，相鄰兩個的二元組建倒排索引。
3. 查詢的每個殘餘取共有二元組最多的前 `topM` 個單位（依計數分桶，不必排序）。

### 3.6 第二階段：加權 DP 與分數

每個（查詢殘餘, 候選單位）做加權編輯距離（tropical 半環），轉移有三種：
- 單一音段的對應：查詢與詞幹都以「格」表示，所有切法一起比（`ng` 可以是一段，也可以是 n＋g）；
- 前後文單位（第 3.2 節）；
- 「打錯」：刪除或插入一個字元各 `typo`。表中沒有的差異也走這裡。

```
分數 ＝ min over 分析與方言假設 [ 距離_ab(查詢殘餘, 詞條詞幹) ＋ λ ×（兩邊剝掉的詞綴數） ]
```

- 查詢的方言未知：對每個假設的查詢方言 a 取最好的（包括與詞條同一個方言）。方言未知的詞條也假設方言 b。
- λ（`lambda`）是每剝一個詞綴的成本，大約與一個沒見過的差異同一個量級。沒有它時，剝得越多、殘餘越短、距離越小，會過度剝。

### 3.7 寬鬆程度

```
標準：分數 ≤ a ＋ b · n（預設 4 ＋ 0.6n）       n ＝ 查詢的字元數
寬鬆：分數 ≤ a ＋ b · n（預設 5 ＋ 0.8n）
精確：詞幹與查詢完全相同、沒有剝詞綴
```

- 門檻隨詞長放寬，與 BCDP 的模糊程度同一個形式。
- 預設值在巴宰–噶哈巫語上校準：結果數的中位數與平均不多於 BCDP 同名的等級，其中品質最好的。
- **門檻綁著成本的刻度**：學習的資料、λ、`typo` 改了，都要重新校準（第 4 節步驟 6）。

### 3.8 說明

每個命中的說明有：
- 假設的查詢方言與詞條方言；
- 兩邊剝掉的詞綴；
- 詞幹的對齊（DP 回溯）。每一步是兩邊相同、學到的對應、學到的前後文單位，還是打錯。
- 前後文單位另附「拆開來看」：同一段若逐音段以單一音段的對應比對，是哪幾步、合計多少。
  例如 ura → owa 拆開是 u → o、r → ∅、∅ → w，合計比整段貴，說明前後文的作用。這只是對照，不表示演變的先後。

對齊只為畫面上前幾筆計算。

## 4. 製作模型

學習分兩部分，都在站台之外離線執行，資料更新時重做一次。**只用可以公開的資料學習。**
- 同源判斷與對齊：Python 的 [LingPy](https://lingpy.org)（LexStat）；
- 數對應組與歸納前後文單位：框架的 `learnCorrespondences`（`babizu/search`）。

1. **詞表**：每一列（方言, 詞義, 詞形）。多數辭典沒有現成的詞表，可以依釋義配對：
   - 釋義去掉括號內的說明、依分隔符號切開，同一個釋義在兩個方言都有詞的成為一個詞義；
   - 任一側超過 3 個詞形的釋義太籠統，不收；
   - LexStat 大約要 200 個詞義以上。
2. **切段與 IPA**：書寫的多字元段以最長匹配切開；送進 LingPy 前換成 IPA（LingPy 的音類模型讀 IPA），學完換回書寫。
3. **同源判斷**：
   ```python
   from lingpy.compare.lexstat import LexStat
   lex = LexStat(rows, segments='tokens', check=False)   # rows[k] = [方言, 詞義, 字串, [段…]]
   lex.get_scorer(runs=1000)                             # 置換法學每對方言的對應分數（先 random.seed，結果才能重現）
   lex.cluster(method='lexstat', threshold=0.6, ref='cogid')
   ```
   門檻沒有真值時，抽一些詞對請懂語言的人判斷。
4. **對齊與修剪**：
   - 判為同源的每一對詞以 `lex.align_pairs(a, b, method='lexstat', mode='global', pprint=False, return_raw=True)` 對齊；
   - 從詞的兩端剝掉「連續兩欄以上都有缺口」的段（詞綴般的長度），只有一欄的缺口留下（詞尾的音段脫落是真的對應）。
5. **數對應組、歸納前後文單位**（第 5 節）：
   ```ts
   import { learnCorrespondences, validateCsrModel } from 'babizu/search'
   const learned = learnCorrespondences(['pazeh', 'kaxabu'], pairs, { poolVowels: true })
   // pairs[k] = { forms: [巴宰的詞, 噶哈巫的詞], cols: [[段或 '-', 段或 '-'], …], cut: [前面修剪的欄數, 後面修剪的欄數] }
   const model = { format: 'babizu-csr-model', version: 1, dialects, segments, patterns: learned.patterns, occurrences: learned.occurrences }
   validateCsrModel(model, varieties)   // 空陣列才寫出
   ```
   `learned.units` 是報告：每個前後文單位的成員、次數、支持度、增益、成本與例詞。**例詞不要寫進公開的模型。**
6. **校準寬鬆程度與評估**：
   - 以釋義配對當金標準（同一個釋義在另一個方言的詞）；
   - 詞義分兩半，輪流用一半學習、另一半評估（不洩漏）；
   - 對每個查詢算出不設門檻的全部結果，在「分數 ≤ a ＋ b·n」的網格上找結果數不超過目標（例如 BCDP 同名等級）、品質最好的 (a, b)，寫進 `levels`。

巴宰–噶哈巫語數位辭典的模型就是這樣做的（兩個方言、851 個詞義、約 950 對同源詞）。
釋義配對的兩折評估上，第一個答案的倒數名次平均（MRR）：

| 方法 | 標準 | 寬鬆 |
|---|---|---|
| 對應組檢索（不用任何手寫規則） | 0.627 | 0.645 |
| BCDP（網站的語言設定檔，含手寫規則） | 0.606 | 0.636 |

## 5. 學習：解釋掉與前後文單位

`learnCorrespondences(dialects, pairs, options)` 只用資料，不收手寫規則。

1. **單一音段**：每一欄（x, y）數一次。
2. **前後文單位的候選**：
   - 二到 `maxColumns` 欄的連續欄，至少一欄兩邊不同；
   - 沒修剪的一端多一個「詞界欄」，含詞界的單位就有位置；
   - **支持度**：單位出現的詞對中，兩個方言各有幾個不同的詞，取小的。至少 `minSupport`，所以一個詞造不出單位
     （maturay、paturay 都對到 matoway 時支持度只有 1）。
3. **貪婪的最小描述長度**：
   ```
   增益 ＝ Σ 出現處（這幾欄以目前單一音段的模型算的成本 − 單位的成本）− penalty
   ```
   - 成本都是兩個方向的 −log 條件機率相加；
   - 每次挑增益最大的單位，把它出現處的欄從單一音段的計數拿掉（**解釋掉**），重算，直到沒有正的增益。
   - 只在某個前後文出現的對應，會被那個前後文的單位解釋掉；剩下的欄數不到 `minSites` 時，就不再是不看前後文的對應。
   - 這是硬指派的多對多對齊歸納（m2m-aligner，Jiampojamarn et al. 2007），加上每個單位的描述長度懲罰（同 Morfessor 的 MDL，Creutz & Lagus 2007）。
4. **元音類合併**（`poolVowels`）：
   - 以 Sukhotin 演算法從資料的分布分出元音（字母相鄰的矩陣；不是人指定的）。
   - 單位頭尾那一欄的某一邊是元音時，也試著把「那一邊是任何元音」的幾個單位合成一個家族，支持度與成本以整個家族計算。
     例如 ura → owa 與 ara → owa 各只有一個噶哈巫詞，合起來兩個詞成為 ?ra → owa。
   - 只寫出實際出現過的成員（ura、ara），不推到沒見過的元音。

| 選項 | 預設 | 說明 |
|---|---|---|
| `maxColumns` | 3 | 前後文單位最多幾欄（不含詞界欄） |
| `minSupport` | 2 | 兩個方言各至少幾個不同的詞 |
| `penalty` | 16 | 每個單位的描述長度懲罰（nats）；在巴宰–噶哈巫語的兩折評估上選的 |
| `poolVowels` | false | 以學出的元音類合併頭尾的前後文 |
| `minSites`、`beta`、`typo` | 2、1、4 | 與執行期相同 |

學到的單位並非都是語音對應：兩個方言選了不同前綴的詞（p : m、mu : ta）也會成為詞首的單位。
它們同樣出自資料，說明會照實顯示；要區分「語音對應」與「詞綴選擇」需要詞綴範圍的標記，這還沒有做。

## 6. 誠實的界線：哪些是人寫的

對應組檢索的賣點是「不寫規則」。下表列出仍由人決定的部分：

| 部分 | 來源 |
|---|---|
| 語音對應（單一音段、前後文單位） | **全部由資料學出**。框架不讀語言設定檔的方言規則（`rules`），改了規則，對應組檢索的結果不變 |
| 元音類（`poolVowels`） | 由資料分出（Sukhotin 演算法） |
| 去詞綴：詞綴清單、構詞音變 | 語言設定檔的構詞規格（**人寫的**） |
| 書寫的切段（`segments`）、送進 LingPy 前轉 IPA 的對照 | 站台寫的 |
| 同源判斷的門檻、λ、`typo`、`penalty`、寬鬆程度 | 在釋義配對的評估上選。金標準是辭典的釋義（人編的辭典內容），不是為對應組檢索另外標注的資料 |

**為什麼不把手寫規則當先驗**：
- 第一版曾經這樣做：每條規則拆成段層級的編輯，兩個方向各加 2 欄。
  結果規則 `ura → owa`（滑音產生）被拆成不看前後文的 u → o、r → w，說明裡的 r → w 看起來像是學到的對應。
- 混進規則之後，就分不出說明中的對應是來自資料還是人。BCDP 已經是手寫規則的方法。
- 代價：在巴宰–噶哈巫語的評估上，規則先驗讓 MRR 約高 0.01。

## 7. 參數

| 參數 | 預設 | 說明 |
|---|---|---|
| `lambda` | 3 | 每剝一個詞綴的成本 |
| `typo` | 4 | 表中沒有的差異（打錯、沒見過的對應）：刪除或插入一個字元的成本 |
| `topM` | 300 | 第一階段每個殘餘取幾個候選 |
| `mergeProbability` | 0.7 | 音類合併的門檻 |
| `beta` | 1 | 「兩邊相同」的平滑 |
| `minSites` | 2 | 對應組至少幾欄（前後文單位：幾次）才用 |
| `scoreScale` | 0.2 | 分數換算成 BCDP 的刻度（打錯 4 → 0.8，約是 BCDP 插入一個字元；每剝一個詞綴 3 → 0.6，約是 BCDP 的構詞命中） |

## 8. 限制

- 只在一對真實的方言（巴宰–噶哈巫）上驗證過；多方言的優勢在合成資料上看到。
- **資料少時前後文的證據薄**：
  - ura → owa 只靠兩個噶哈巫詞；
  - 「u、a 之間插入 w」只有一個詞，學不出來，所以也推不出有先後的演變鏈（說明只列「拆開來看」）。
- 在巴宰–噶哈巫語的評估上，前後文單位沒有讓 MRR 變好（與只用單一音段的差在 ±0.004 以內）。它的價值在於說明符合資料的前後文，
  例如單獨的 r → w 不再是對應。
- 去詞綴比 BCDP 的構詞搜尋粗：沒有組合規則、沒有一個字元的中綴、沒有完整重疊；詞綴沒有方言之分；詞綴的部分是人寫的。
- 找的是同源詞，不是同義詞：同義而不同源的詞找不到。
- 門檻的數值綁著成本的刻度，換資料或參數要重新校準。

## 9. 文獻

- List, J.-M. 2012. LexStat: Automatic detection of cognates in multilingual wordlists. EACL 2012 Joint Workshop of LINGVIS & UNCLH, 117–125.
- List, J.-M., S. J. Greenhill, R. D. Gray. 2017. The potential of automatic word comparison for historical linguistics. PLOS ONE 12(1): e0170046.
- List, J.-M. 2019. Automatic inference of sound correspondence patterns across multiple languages. Computational Linguistics 45(1): 137–161.
- Blum, F., J.-M. List. 2023. Trimming phonetic alignments improves the inference of sound correspondence patterns from multilingual wordlists. SIGTYP 2023, 52–64.
- Ristad, E. S., P. N. Yianilos. 1998. Learning string edit distance. IEEE TPAMI 20(5).
- Jiampojamarn, S., G. Kondrak, T. Sherif. 2007. Applying many-to-many alignments and hidden Markov models to letter-to-phoneme conversion. NAACL-HLT 2007, 372–379.
- Creutz, M., K. Lagus. 2007. Unsupervised models for morpheme segmentation and morphology learning. ACM Transactions on Speech and Language Processing 4(1).
- Sukhotin, B. V. 1962. Eksperimental'noe vydelenie klassov bukv s pomoshch'ju EVM. Problemy strukturnoj lingvistiki.
- Guy, J. B. M. 1991. Vowel identification: an old (but good) algorithm. Cryptologia 15(3): 258–262.
- 「對應組」（correspondence set）是比較法的傳統術語（Hoenigswald 1960；Anttila 1972）。
