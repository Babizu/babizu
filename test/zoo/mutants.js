/**
 * @file 錯誤解法動物園的突變清單（見 ./run.mjs）。
 *
 * 每一項：
 * - name：突變的名稱
 * - file、find、replace：在哪個檔案把哪一段程式（必須恰好出現一次）換成什麼
 * - why：它模擬的錯誤，以及預期由哪個測試殺掉
 *
 * 刻意不收的突變：
 * - 相對上限（最佳 ＋ lemmaSpread）不把查詢本身排除：只在詞庫剛好含有查詢、而且它比真正的最佳還便宜時才會錯，
 *   隨機測試幾乎碰不到；由 finish 與 SpreadCutoff.eligible 共用同一個條件的程式審查守著。
 * - 普通搜尋（沒有交界）編譯時略過構詞音變的 continue 拿掉：admissible 在沒有交界的位置本來就不收構詞音變，
 *   只是變慢，是等價突變；junction.test.js「構詞音變只在詞素交界適用」守著結果。
 * - 實驗室元件（app/）的突變：動物園只跑 node 端的測試；實驗室與搜尋的一致性由 app 端的 lab-state 測試守著。
 */

export const MUTANTS = [
  {
    name: '詞素交界可以在空白旁（遮罩拿掉）',
    file: 'src/fuzzy/dp.js',
    find: 'for (let i = 0; i <= n; i++) if ((i > 0 && this.isBoundary(x[i - 1])) || (i < n && this.isBoundary(x[i]))) junctionMask[i] = 1',
    replace: 'void junctionMask',
    why: '多詞查詢會把 mu daux 分析成 mu- ＋ daux；詞綴各層的性質測試與隨機仲裁（查詢含空白）',
  },
  {
    name: '有位置限制的規則可以跨越交界',
    file: 'src/fuzzy/dp.js',
    find: '  if (start === EDGE_CROSS) return false\n',
    replace: '\n',
    why: '詞尾規則的 target 從前一段開始；ref-joint 的逐一比對與隨機仲裁',
  },
  {
    name: '交界上仍檢查 X 側的位置條件',
    file: 'src/fuzzy/dp.js',
    find: '          if (xfail && !junctions) continue',
    replace: '          if (xfail) continue',
    why: "tau'alawan 的 ' 在交界上找不到 alaw；bcdp-reference 的固定案例與 ref-joint",
  },
  {
    name: '沒有指定側的構詞音變在詞中也適用',
    file: 'src/fuzzy/dp.js',
    find: '  if (flag & FLAG_JUNCTION && !(flag & (FLAG_INITIAL | FLAG_FINAL)) && start !== EDGE_JUNCTION && end !== EDGE_JUNCTION) return false\n',
    replace: '\n',
    why: '構詞搜尋的詞幹內部也套用構詞音變；ref-joint 的逐一比對',
  },
  {
    name: '交界狀態合併時不取 min',
    file: 'src/fuzzy/junction.js',
    find: '    if (v < into.row[x] || (v === into.row[x] && v < Infinity && before?.(tag, into.tags.row[x]))) {',
    replace: '    if (v < Infinity) {',
    why: '後合併的詞綴鏈蓋掉較便宜的；詞綴各層合併的性質測試',
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
    find: "(rule.position === 'final' && !(i === n || this.isBoundary(x[i]))))",
    replace: "(rule.position === 'final' && !(i >= n - 1 || this.isBoundary(x[i]))))",
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
    name: '相對上限的起點當成處處可以在詞尾結束',
    file: 'src/fuzzy/morph-search.js',
    find: 'prefixed + (y === n ? 0 : S.row[y])',
    replace: 'prefixed',
    why: '起點比真正的最佳還低，剪掉最佳 ＋ spread 之內的詞；morph-search「相對上限」的性質測試',
  },
  {
    name: '耦合位能不取之後的最小值',
    file: 'src/fuzzy/fuzzy-index.js',
    find: '        for (let x = n - 1; x >= 0; x--) if (e[x + 1] < e[x]) e[x] = e[x + 1]',
    replace: '        void e',
    why: '位能高估（之後的位置結束更便宜），剪掉上限內的詞；隨機仲裁',
  },
  {
    name: '逐字相同的捷徑只比長度',
    file: 'src/fuzzy/distance.js',
    find: '      for (const ch of segments[k].chars) if (ch !== x[i++]) same = false',
    replace: '      for (const ch of segments[k].chars) void (ch !== x[i++])',
    why: '衍生形方向把不同的詞當成音變為 0；jointDistance 與 ref-joint 的比對、engine 的衍生形測試',
  },
  {
    name: 'jointDistance 的剪枝在每段第 0 列忽略前一段未走完的規則',
    file: 'src/fuzzy/distance.js',
    find: '        const unfinished = j === 0 ? (cross[0] ?? null) : crossing',
    replace: '        const unfinished = crossing',
    why: '跨越交界的規則（例如 a｜a 的元音合併）在交界上被剪掉；junction.test.js 的 jointDistance 對 ref-joint',
  },
  {
    name: '前綴式環綴的通道可以不接後綴就結束',
    file: 'src/fuzzy/morph-search.js',
    find: 'to: { row: end.row, pending: end.pending, word: suffix ? null : word } },',
    replace: 'to: { row: end.row, pending: end.pending, word } },',
    why: 'ta-kita 被當成 ta-…-aw；bcdp-reference 的固定案例「環綴一定要接它的後綴」與隨機仲裁（環綴）',
  },
  {
    name: '中綴、重疊式環綴的變體可以不接後綴就結束',
    file: 'src/fuzzy/morph-search.js',
    find: '        if (member.suffix === null && v.ends(m)) vWord[m] = Math.min(vWord[m], member.cost)',
    replace: '        if (v.ends(m)) vWord[m] = Math.min(vWord[m], member.cost)',
    why: 'binaket 被當成 <in>…-an；bcdp-reference 的固定案例「環綴一定要接它的後綴」與隨機仲裁（環綴）',
  },
  {
    name: '環綴的成本沒有算進起點',
    file: 'src/fuzzy/morph-search.js',
    find: 'mergeInto(group.start, Pc, c.cost, c, byRank)',
    replace: 'mergeInto(group.start, Pc, 0, c, byRank)',
    why: '環綴免費；bcdp-reference 的隨機仲裁與 search/morphology 的環綴測試',
  },
  {
    name: '環綴的兩側只從詞首（詞尾）出發',
    file: 'src/fuzzy/morph-search.js',
    find: '    if (isReachable(after)) origins.push({ from: after, origin: 1 })',
    replace: '    void after',
    why: '外面再加前綴的環綴（mu-bin…an）找不到；bcdp-reference 的隨機仲裁與 search/morphology 的環綴測試',
  },
  {
    name: '交界狀態合併跨界表時不取 min',
    file: 'src/fuzzy/junction.js',
    find: '      if (v < target.row[x] || (v === target.row[x] && v < Infinity && before?.(tag, tags[x]))) {',
    replace: '      if (v < Infinity) {',
    why: '跨界規則由後合併的鏈蓋掉較便宜的（例如後綴相同的環綴共用起點）；詞綴各層合併的性質測試與隨機仲裁',
  },
  {
    name: '重複的查詢詞不累加走訪統計',
    file: 'src/search/engine.js',
    find: 'response.stats.visitedNodes += prev.visited',
    replace: 'void prev.visited',
    why: '回應的統計與逐次計算不同；engine 測試「重複的查詢詞只算一次，統計照樣累加」',
  },
  {
    name: '構詞命中遇到同一個詞的模糊命中一律捨棄（v0.2.0 起的原始寫法）',
    file: 'src/search/engine.js',
    find: '        if (!prev || isBetterMatch(m, prev, key)) matches.set(m.term, m)',
    replace: "        if (!prev || (prev.matchType !== 'fuzzy' && isBetterMatch(m, prev, key))) matches.set(m.term, m)",
    why: '查 parazem 時 razem 只剩模糊命中 1.2；morphology 測試「同一個詞有多種命中方式」',
  },
  {
    name: '詞條家族的名次取樹根的分數，而不是家族中最好的命中',
    file: 'src/search/family.js',
    find: '    const best = all.reduce((a, b) => (compareHits(b, a) < 0 ? b : a))',
    replace: '    const best = root.hit ?? all[0]',
    why: '子項目完全相同時家族不會往上排；family 測試「家族的名次取最好的命中」',
  },
  {
    name: '構詞文法：中綴插在前綴首輔音之後的位置差一',
    file: 'src/fuzzy/grammar.js',
    find: '      if (h < chars.length) L = [...chars.slice(0, h), s.form, ...chars.slice(h)].join(\'\')',
    replace: '      if (h < chars.length) L = [...chars.slice(0, h + 1), s.form, ...chars.slice(h + 1)].join(\'\')',
    why: 'mu ＋ <in> 展開成 muin 而不是 minu；grammar.test 的展開結果與引理',
  },
  {
    name: '構詞文法：沒有元音的前綴插入中綴時直接接成字串（不交給詞根）',
    file: 'src/fuzzy/grammar.js',
    find: '      if (h < chars.length) L = [...chars.slice(0, h), s.form, ...chars.slice(h)].join(\'\')\n      else if (op)',
    replace: '      if (true) L = [...chars.slice(0, h), s.form, ...chars.slice(h)].join(\'\')\n      else if (op)',
    why: 'm<a>- 對輔音開頭的詞根也成了 ma-（mabaket 被說成 m<a>-）；grammar.test 的引理與固定案例',
  },
  {
    name: '構詞文法：組合規則的詞素順序顛倒',
    file: 'src/fuzzy/grammar.js',
    find: '      for (const form of formsOf(members[k])) walk(k + 1, [...parts, partOf(members[k], form)])',
    replace: '      for (const form of formsOf(members[k])) walk(k + 1, [partOf(members[k], form), ...parts])',
    why: '推導順序反了（mu ＋ <in> 變成 <in> ＋ mu）；grammar.test 的展開結果',
  },
  {
    name: '包覆單位的外側前綴沒有算進詞幹的起點（起點取自自由的前綴鏈）',
    file: 'src/fuzzy/morph-search.js',
    find: '        const Pc = circP.get(outer)',
    replace: '        const Pc = P',
    why: 'm<a>- 的 m 不用付對齊的成本；bcdp-reference 的窮舉比對（wrap:outer）',
  },
  {
    name: '要求詞幹元音開頭的環綴沒有限制詞幹',
    file: 'src/fuzzy/morph-search.js',
    find: '...(vowelStem ? { initials: vowelSet } : {})',
    replace: '...{}',
    why: 'mabaket 被說成 m<a>- ＋ baket；grammar.test 的固定案例與 bcdp-reference 的窮舉比對',
  },
  {
    name: '同分時的說明選規格中較後的',
    file: 'src/fuzzy/morph-search.js',
    find: '  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return x[k] - y[k]',
    replace: '  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return y[k] - x[k]',
    why: 'mausa、mausay 被說成 ma-（靜態）；grammar.test 的固定案例',
  },
  {
    name: '另立條目對到多個同形詞目時接到第一個',
    file: 'src/search/family.js',
    find: '        if (all.length === 1) return all[0]',
    replace: '        if (all.length >= 1) return all[0]',
    why: '同形異義詞被接錯；family 測試「對不到唯一一個詞目時不連」',
  },
]
