/**
 * @file 錯誤解法動物園的突變清單（見 ./run.mjs）。
 *
 * 每一項：
 * - name：突變的名稱
 * - file、find、replace：在哪個檔案把哪一段程式（必須恰好出現一次）換成什麼
 * - why：它模擬的錯誤，以及預期由哪個測試殺掉
 *
 * 刻意不收的突變：
 * - 候選階段改用真正的邊界值（不歸零）：結果完全相同、只是變慢，是等價突變；效能由私有 repo 的 A/B 量測守著。
 * - 計價同分時改取較長的詞幹：成本不變，只改變說明中詞綴與詞幹的切法；參考實作只比成本，
 *   說明的切法由 explain 與 search 共用同一個 priceTerm，無法互相仲裁。這一項由 bcdp.md 1.2 的定義與人工審查守著。
 * - 實驗室元件（app/）的突變：動物園只跑 node 端的測試；實驗室與搜尋的一致性由 app 端的 lab-state 測試守著。
 * - 詞幹長度過濾的上界少 1（ceil(λ ÷ 每字元代價 ＋ ε) − 1）：原本的 ceil 比精確上界 floor 多 1，
 *   減 1 正好是精確上界，結果不變，是等價突變。改收「比精確上界再少 1」（第 3 號）。
 */

export const MUTANTS = [
  {
    name: '詞素交界可以在空白旁（遮罩拿掉）',
    file: 'src/fuzzy/morph-search.js',
    find: 'for (let i = 1; i < n; i++) if (isBoundary(chars[i])) bestP.cost[i] = Infinity',
    replace: 'for (let i = 1; i < n; i++) void isBoundary(chars[i])',
    why: '多詞查詢會把 mu daux 分析成 mu- ＋ daux；bcdp-reference 的固定案例與隨機仲裁',
  },
  {
    name: '詞幹交替的說明不檢查 before',
    file: 'src/fuzzy/morph-search.js',
    find: 'if (before && !before.includes(e.affix.form)) continue',
    replace: 'void before',
    why: '說明中的後綴可能不在 before 清單；bcdp-reference「詞幹交替的說明」',
  },
  {
    name: '詞幹長度的過濾比精確上界少 1',
    file: 'src/fuzzy/morph-search.js',
    find: 'return perChar > 0 ? Math.ceil(spec.lemmaDistance / perChar + 1e-9) : Infinity',
    replace: 'return perChar > 0 ? Math.floor(spec.lemmaDistance / perChar + 1e-9) - 1 : Infinity',
    why: '長度差剛好在上界、成本剛好等於 λ 的切法被丟掉；隨機仲裁與 bcdp-reference 的固定案例',
  },
  {
    name: 'CVCVC 不收韻尾',
    file: 'src/fuzzy/morphology.js',
    find: "if (pattern === 'CVCVC') while (k < n && !vowels.has(chars[k])) k++",
    replace: "if (pattern === 'CVCVC') void n",
    why: 'kudung~kudung 找不到；morphology 的模板表與 bcdp-reference 的重疊型式',
  },
  {
    name: '穩定引理差一',
    file: 'src/fuzzy/morphology.js',
    find: 'if (whole === red) for (let l = stable; l <= rest.length; l++) out.push(l)',
    replace: 'if (whole === red) for (let l = stable + 1; l <= rest.length; l++) out.push(l)',
    why: '詞幹剛好等於模板長度時漏掉；reduplicantStems 的性質測試',
  },
  {
    name: 'mayDerive 沒有無元音詞幹的例外',
    file: 'src/fuzzy/morphology.js',
    find: 'if (infixes.length && !Array.from(stem).some((c) => vowels.has(c))) return true',
    replace: 'void infixes',
    why: '中綴落在後綴裡時核心形式不連續，必要條件不成立；mayDerive 的性質測試',
  },
  {
    name: '剪枝過度（上限少 0.05）',
    file: 'src/fuzzy/fuzzy-index.js',
    find: 'const pruned = endEdge > firstEdge && lowerBound > bound + EPSILON',
    replace: 'const pruned = endEdge > firstEdge && lowerBound > bound - 0.05',
    why: '剛好在上限內的詞被剪掉；邊界條件與詞圖搜尋的暴力比對',
  },
  {
    name: '多通道漏掉第 0 個通道',
    file: 'src/fuzzy/fuzzy-index.js',
    find: 'if (!pruned) next[nextCount++] = c',
    replace: 'if (!pruned && c > 0) next[nextCount++] = c',
    why: '普通模糊搜尋（通道 0）只剩根節點；多通道性質測試與幾乎所有搜尋測試',
  },
  {
    name: '詞尾規則在詞尾前一格也適用',
    file: 'src/fuzzy/dp.js',
    find: "if (rule.position === 'final' && !(i === n || this.isBoundary(x[i]) || extraFinal?.[i])) continue",
    replace: "if (rule.position === 'final' && !(i >= n - 1 || this.isBoundary(x[i]) || extraFinal?.[i])) continue",
    why: '詞中的 l 被當成詞尾；refDistance 的逐一比對',
  },
  {
    name: 'align 同分時取後回報的候選',
    file: 'src/fuzzy/distance.js',
    find: 'c === cost[at] && p < priority[at]',
    replace: 'c === cost[at] && p <= priority[at]',
    why: '對齊與 explain 不同；explain 測試的 align 比對',
  },
  {
    name: '步驟狀態的圖表不取最小值',
    file: 'src/fuzzy/steps.js',
    find: 'if (table[f.at] === null || cost < /** @type {number} */ (table[f.at])) table[f.at] = cost',
    replace: 'table[f.at] = cost',
    why: '較後、較貴的槽位蓋掉較便宜的值；steps 測試「同一個位置有多條鏈時，圖表取最小值」',
  },
  {
    name: '重複的查詢詞不累加走訪統計',
    file: 'src/search/engine.js',
    find: 'response.stats.visitedNodes += prev.visited',
    replace: 'void prev.visited',
    why: '回應的統計與逐次計算不同；engine 測試「重複的查詢詞只算一次，統計照樣累加」',
  },
]
