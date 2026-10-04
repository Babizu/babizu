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
 * - 確定同根不扣掉自己這一支（_dictionaryRelations 的 !down.has(k)、!up.has(k)）：自己的下層經上層繞回來，
 *   層數是往上 u ＋ u ＋ 原本的層數，一定比直接往下深，put 取最淺的一種，結果不變，是等價突變；留著只為寫明意圖。
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
    name: 'CVG 不檢查第一個元音是不是滑音（ziu 同時是 CGV 與 CVG）',
    file: 'src/fuzzy/morphology.js',
    find: "const ok = pattern === 'CGV' ? onglide : !onglide && glides.has(chars[v1 + 1])",
    replace: "const ok = pattern === 'CGV' ? onglide : glides.has(chars[v1 + 1])",
    why: 'CVG(ziux) 應該不適用；morphology.test.js 的模板表與參考實作的隨機仲裁',
  },
  {
    name: 'CGV、CVG 的元音核可以超過兩個元音',
    file: 'src/fuzzy/morphology.js',
    find: 'if (k - v1 !== 2 || chars[v1] === chars[v1 + 1]) return null',
    replace: 'if (k - v1 < 2 || chars[v1] === chars[v1 + 1]) return null',
    why: '穩定引理與 reduplicantStems 的逐一檢查（uia… 開頭的詞幹）、參考實作的隨機仲裁',
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
    name: '前綴式環綴的通道可以不接後綴就結束',
    file: 'src/fuzzy/morph-search.js',
    find: 'to: { row: end.row, pending: end.pending, word: null } } })',
    replace: 'to: { row: end.row, pending: end.pending, word } } })',
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
    find: 'mergeInto((group.start ??= emptyJunction(n)), Pc, c.cost, c, byRank)',
    replace: 'mergeInto((group.start ??= emptyJunction(n)), Pc, 0, c, byRank)',
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
    file: 'src/search/scoring.js',
    find: "  if (m.matchType === 'sibling' || a >= b - EPSILON) return keep(prev, m)",
    replace: '  return keep(prev, m)',
    why: '查 parazem 時 razem 只剩模糊命中 1.2；morphology 測試「同一個詞有多種命中方式」、scoring 測試',
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
    name: '要求詞幹元音開頭的環綴沒有限制詞幹（併進通道時，所有詞都由合併後的起點出發）',
    file: 'src/fuzzy/morph-search.js',
    find: '      options.initialFrom = { initials: vowelSet, from: start }',
    replace: '      options.from = start',
    why: 'mabaket 被說成 m<a>- ＋ baket；grammar.test 的固定案例與 bcdp-reference 的窮舉比對',
  },
  {
    name: '說明時元音開頭的詞仍由原本的起點追溯（沒有用合併後的起點）',
    file: 'src/fuzzy/morph-search.js',
    find: '    const start = v.alt && vowelSet.has(Array.from(result.term)[0]) ? v.alt.start : /** @type {Level | undefined} */ (options.from)',
    replace: '    const start = /** @type {Level | undefined} */ (options.from)',
    why: '由元音開頭環綴得到的命中說明不出環綴（或追溯出錯）；grammar.test 的 mausay 與 bcdp-reference 的固定案例',
  },
  {
    name: '元音開頭環綴併進前綴鏈的起點時，同分改成環綴優先（不看步驟數與規格順序）',
    file: 'src/fuzzy/morph-search.js',
    find: '  if (current > 1) return true\n',
    replace: '  return true\n',
    why: 'mausa 被說成 m<a>-（自由詞素 ma- 應該優先）；grammar.test 的固定案例',
  },
  {
    name: 'initialFrom：以 initials 開頭的詞沒有換上另一個起點的跨界表',
    file: 'src/fuzzy/fuzzy-index.js',
    find: '              const cross = alt ? a.cross : base.cross',
    replace: '              const cross = base.cross',
    why: '跨越交界的規則在另一個起點上失效；junction.test 的 initialFrom 性質測試',
  },
  {
    name: 'initialFrom：根節點的每條邊用錯了哪一套起點的下界剪枝',
    file: 'src/fuzzy/fuzzy-index.js',
    find: '              if ((alt ? a.lowerBound : base.lowerBound) > bound + EPSILON) continue',
    replace: '              if ((alt ? base.lowerBound : a.lowerBound) > bound + EPSILON) continue',
    why: '該走的子樹被剪掉；junction.test 的 initialFrom 性質測試',
  },
  {
    name: '同分時的說明選規格中較後的',
    file: 'src/fuzzy/morph-search.js',
    find: '  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return x[k] - y[k]',
    replace: '  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return y[k] - x[k]',
    why: 'mausa、mausay 被說成 ma-（靜態）；grammar.test 的固定案例',
  },
  {
    name: '自動派生圖收下所有詞根，不只最好的',
    file: 'src/search/derivations.js',
    find: '      if (hit.distance > hits[0].distance + EPSILON) continue',
    replace: '      void hits',
    why: 'pausunguday 直接連到 sungut（雜訊多）；derivations 測試「最好詞根是 pusungut，不是 sungut」',
  },
  {
    name: '自動派生圖依詞編號（字典序）鬆弛，不依詞長',
    file: 'src/search/derivations.js',
    find: '.sort((a, b) => this._len(a) - this._len(b) || a - b)',
    replace: '.sort((a, b) => a - b)',
    why: '字典序不是拓撲順序：pausunguday 在 pusungut 之前處理，走不到；derivations 測試「查 sungut 找到 pausunguday」',
  },
  {
    name: '自動派生圖只限制每一條邊，不限制整條路徑',
    file: 'src/search/derivations.js',
    find: '        if (path > maxPath + EPSILON) continue',
    replace: '        void path',
    why: '兩條各在上限內的邊相加超過上限；derivations 測試「路徑成本不超過上限」',
  },
  {
    name: '寬鬆時仍只用方言變體當自動派生的起點',
    file: 'src/search/engine.js',
    find: '    return level.derivedFromAll || (m.distance',
    replace: '    return false || (m.distance',
    why: '查 sugut 找不到 pausunguday；derivations 測試「寬鬆：查詢的相近寫法也當起點」',
  },
  {
    name: '開頭相符、包含的詞能自動派生時仍保留原本的命中',
    file: 'src/search/scoring.js',
    find: '  if (PARTIAL.has(prev.matchType)) return keep(m, prev, { score: Math.min(a, b) })',
    replace: '  if (PARTIAL.has(prev.matchType)) return keep(prev, m)',
    why: '開頭相符的 sungutan 沒有派生的說明；derivations 測試「開頭相符又能自動派生的詞」、scoring 測試',
  },
  {
    name: '辭典派生詞不加層數的差距',
    file: 'src/search/scoring.js',
    find: '  return Math.round((score + depth * DERIVATIVE_PENALTY) * 1e9) / 1e9',
    replace: '  return score',
    why: '派生詞與詞本身同分；scoring 測試、derivations 測試「含 mukusa 的例句分數是 usa 的分數加一層」',
  },
  {
    name: '例句的辭典派生詞也從寫法相近的詞條展開',
    file: 'src/search/engine.js',
    find: "        if (t.matchType !== 'fuzzy' || t.distance > 0) continue",
    replace: "        if (t.matchType !== 'fuzzy') continue",
    why: '查 sungut 時 zenget 的派生詞 kizenget 排到 pausunguday 之前；derivations 測試「只從寫法與查詢相同的詞條展開」',
  },
  {
    name: '虛擬詞根不必比詞庫中的詞根好 VIRTUAL_ROOT_PENALTY',
    file: 'src/search/derivations.js',
    find: '        a.cost + VIRTUAL_ROOT_PENALTY < lexiconBest - EPSILON &&',
    replace: '        a.cost < lexiconBest - EPSILON &&',
    why: 'dakudan 另建虛擬詞根 dakud（詞庫已有 dakut，只差構詞音變）；derivations 測試「只在詞庫解釋不了時建立」',
  },
  {
    name: '虛擬詞根不檢查形狀（一個音節也收）',
    file: 'src/search/derivations.js',
    find: '        isVirtualRootShape(a.stem, analyzer.spec) &&',
    replace: '        true &&',
    why: 'karaw 拆出 raw，與所有 -raw 結尾的詞巧合同根；derivations 測試',
  },
  {
    name: '虛擬詞根不檢查本身是不是根',
    file: 'src/search/derivations.js',
    find: '        !analyzer.analyze(a.stem).some((b) => index.dawg.lookup(b.stem) !== -1),',
    replace: '        true,',
    why: 'mabaketan 另建 baketan、mabaket（只是 baket 加一個詞綴）；derivations 測試',
  },
  {
    name: '自動同根取代分數較差的其他命中',
    file: 'src/search/scoring.js',
    find: "  if (m.matchType === 'sibling' || a >= b - EPSILON) return keep(prev, m)",
    replace: '  if (a >= b - EPSILON) return keep(prev, m)',
    why: '原本的自動派生、自動拆解被自動同根蓋掉；derivations 測試「自動同根不取代其他命中」',
  },
  {
    name: '被取代的命中不留下來（排除取代它的方法時連它也消失）',
    file: 'src/search/scoring.js',
    find: '  return [m, .../** @type {T[]} */ (m.others ?? [])]',
    replace: '  return [m]',
    why: '排除自動派生後，原本開頭相符的 sungutan 也不見；derivations 測試「搜尋方法」',
  },
  {
    name: '辭典的構詞關係沒有上層（確定拆解）',
    file: 'src/search/engine.js',
    find: "    for (const [k, d] of up) put(k, 'parent', d)",
    replace: '    void up',
    why: '查 pinakita 時 kita-、pakita 不是確定拆解；family 測試',
  },
  {
    name: '記錄上的自動同根與其他命中一樣比分數',
    file: 'src/search/scoring.js',
    find: '  if (a !== b) return b\n',
    replace: '\n',
    why: '詞條的原本命中被自動同根取代；derivations 測試（replacesRecordHit）',
  },
  {
    name: '詞綴的條目也當成同根的依據',
    file: 'src/search/engine.js',
    find: '      if (this._isAffixEntry(a)) continue\n',
    replace: '\n',
    why: '<in> 條下的例子（binaket）成了 kinawas 的確定同根；derivations 測試「詞綴的條目不算同根」',
  },
  {
    name: '家族排序不看記錄原本的直接命中',
    file: 'src/search/family.js',
    find: '    const own = all.filter((h) => h.direct ?? !DICTIONARY_KINDS.has(h.kind))',
    replace: '    const own = all.filter((h) => !DICTIONARY_KINDS.has(h.kind))',
    why: '自動拆解到的 kawas- 以確定拆解呈現後不算證據，<in> 條排到 kawas- 條之前；derivations 測試',
  },
  {
    name: '另立條目對到多個同形詞目時接到第一個',
    file: 'src/search/family.js',
    find: '        if (all.length === 1) return all[0]',
    replace: '        if (all.length >= 1) return all[0]',
    why: '同形異義詞被接錯；family 測試「對不到唯一一個詞目時不連」',
  },
  // 句型搜尋（src/pattern）
  {
    name: '句型：重疊不貪婪（先停再多比）',
    file: 'src/pattern/match.js',
    find: `    if (count < node.max) {
      for (const e of ends(node.node, i)) {
        if (e > i) pushUnique(out, seen, repeatEnds(node, e, count + 1))
      }
    }
    if (count >= node.min) pushUnique(out, seen, [i])`,
    replace: `    if (count >= node.min) pushUnique(out, seen, [i])
    if (count < node.max) {
      for (const e of ends(node.node, i)) {
        if (e > i) pushUnique(out, seen, repeatEnds(node, e, count + 1))
      }
    }`,
    why: '與 RegExp 的區間不同；match 的性質測試',
  },
  {
    name: '句型：量詞上限差一',
    file: 'src/pattern/match.js',
    find: `    if (count < node.max) {
      for (const e of ends(node.node, i)) {
        if (e > i) pushUnique`,
    replace: `    if (count <= node.max) {
      for (const e of ends(node.node, i)) {
        if (e > i) pushUnique`,
    why: 'x{0,1} 比到兩次；match 的性質測試',
  },
  {
    name: '句型：擇一的分支倒過來試',
    file: 'src/pattern/match.js',
    find: '        for (const o of node.options) pushUnique(out, seen, ends(o, i))',
    replace: '        for (const o of [...node.options].reverse()) pushUnique(out, seen, ends(o, i))',
    why: '優先序與 RegExp 不同；match 的性質測試',
  },
  {
    name: '句型：下一次從起點的下一個位置接著找（區間重疊）',
    file: 'src/pattern/match.js',
    find: '      pos = e > s ? e : e + 1',
    replace: '      pos = s + 1',
    why: '與 RegExp 的 g 不同；match 的性質測試',
  },
  {
    name: '句型：不分句',
    file: 'src/pattern/sentences.js',
    find: '      if (isSeparator(ch)) flush(SENTENCE_END.test(ch))',
    replace: '      if (isSeparator(ch)) flush(false)',
    why: '^ $ 與 _* 跨句；sentences 的分句測試、search 的 ^ $ 測試',
  },
  {
    name: '句型：前綴不錨定在最外層（任何位置都算）',
    file: 'src/pattern/morph.js',
    find: '  const prefixOk = req.prefixesAnywhere ? anywhere(req.prefixes, reading.left) : runAt(req.prefixes, reading.left, 0)',
    replace: '  const prefixOk = anywhere(req.prefixes, reading.left)',
    why: 'mi-… 找到 kamikita（ka-mi-kita），v0.6.0 的 imini 雜訊；morph 的 imini 測試、search 的 kamikita 測試',
  },
  {
    name: '句型：後綴錨在內側（從第一個後綴算起）',
    file: 'src/pattern/morph.js',
    find: '    : runAt(req.suffixes, reading.right, reading.right.length - req.suffixes.length)',
    replace: '    : runAt(req.suffixes, reading.right, 0)',
    why: '…-an-ay 找不到 x-i-an-ay、卻找到 x-an-ay-i；morph 的後綴測試',
  },
  {
    name: '句型：列出的前綴不必相連（子序列）',
    file: 'src/pattern/morph.js',
    find: '  const runAt = (want, have, at) => at >= 0 && at + want.length <= have.length && want.every((g, i) => g.forms.has(have[at + i].form))',
    replace: `  const runAt = (want, have, at) => {
    let j = 0
    for (const m of have.slice(Math.max(0, at))) if (j < want.length && want[j].forms.has(m.form)) j++
    return at >= 0 && j === want.length
  }`,
    why: 'pa-ka-… 找到 pa-ma-ka-x；morph 的相連測試',
  },
  {
    name: '句型：外側的 … 被當成錨定',
    file: 'src/pattern/morph.js',
    find: '      prefixesAnywhere: rootAt !== 0 && core[0].wildcard,',
    replace: '      prefixesAnywhere: false,',
    why: '…-pa-… 找不到 mupakita；morph 的外側 … 測試、search 的 mupakita 測試',
  },
  {
    name: '句型：先扣音變再求最好的拆法',
    file: 'src/pattern/morph.js',
    find: '  const best = Math.min(floor, ...parses.map((x) => x.cost))',
    replace: '  const best = Math.min(floor, ...parses.filter((x) => x.sound <= sound + EPSILON).map((x) => x.cost))',
    why: '精確模式改取比最好的差、但沒有音變的拆法；morph 的「先求最好的再扣音變」測試',
  },
  {
    name: '句型：標準模式取差 0.2 以內的拆法',
    file: 'src/pattern/morph.js',
    find: '  normal: Object.freeze({ spread: 0.1, sound: 0.2 }),',
    replace: '  normal: Object.freeze({ spread: 0.2, sound: 0.2 }),',
    why: '標準多收了差 0.2 的拆法；morph 的 PARSE_SELECTION 測試',
  },
  {
    name: '句型：不限制音變',
    file: 'src/pattern/morph.js',
    find: '  return parses.filter((x) => x.cost <= best + spread + EPSILON && x.sound <= sound + EPSILON)',
    replace: '  return parses.filter((x) => x.cost <= best + spread + EPSILON)',
    why: '精確模式收下 bakita（只靠 b→p 的 pa-kita）；morph 的音變上限測試、search 的 bakita 測試',
  },
  {
    name: '句型：取拆法從最好的拆法算起，不看 BCDP 最好的命中',
    file: 'src/pattern/search.js',
    find: '      list = selectParses(all, level, id === -1 ? Infinity : chart.bestOf(id))',
    replace: '      list = selectParses(all, level)',
    why: '標準模式把 pabak 拆成 pa-pa-rak（最好的命中是同長的 barak）；search 的 pabak 測試',
  },
  {
    name: '句型：拆解表不記 BCDP 最好的命中',
    file: 'src/search/derivations.js',
    find: "    if (hits.length && (Array.from(hits[0].term).length >= length || hits[0].term.includes(' '))) bests.push([word, roundCost(hits[0].distance)])",
    replace: '    void bests',
    why: '同上，由建置端漏掉；search 的 pabak 測試、拆解表對自動派生圖測試',
  },
  {
    name: '句型：證據取這個詞最好的拆法，不是符合條件的那一種',
    file: 'src/pattern/search.js',
    find: '    for (const parse of this._parsesOf(key, fuzziness)) if ((roots === null || roots.has(parse.root)) && satisfies(req, parse.reading)) return parse',
    replace: `    const list = this._parsesOf(key, fuzziness)
    if (list.some((parse) => (roots === null || roots.has(parse.root)) && satisfies(req, parse.reading))) return list[0]`,
    why: '…-pa-… 的 mupakita 說明成 mu- ＋ pakita；search 的證據測試',
  },
  {
    name: '句型：不錨定的提示把原本就找到的詞也算進去',
    file: 'src/pattern/search.js',
    find: '    for (const key of this.corpus.docsOf.keys()) if (!found.has(key) && this._matchParse(key, wider, roots, fuzziness)) count++',
    replace: '    for (const key of this.corpus.docsOf.keys()) if (this._matchParse(key, wider, roots, fuzziness)) count++',
    why: 'W_INNER_AFFIX 的數量不是多找到的詞形數；search 的提示測試',
  },
  {
    name: '句型：拆解表漏掉虛擬詞根',
    file: 'src/search/parses.js',
    find: "      virtual.map((e) => ({ ...e, analysis: { ...e.analysis, notes: [] } })),",
    replace: '      [],',
    why: 'mausay、mupuza 的虛擬詞根不在拆解表；search 的拆解表對自動派生圖測試',
  },
  {
    name: '句型：拆解表收下含空白的詞根',
    file: 'src/search/derivations.js',
    find: "      if (!hit.term.includes(' ')) parses.push(",
    replace: '      if (hit.term) parses.push(',
    why: 'pakakita 拆成 pa- ＋「ka kita」；search 的單一個詞測試',
  },
  {
    name: '句型：拆解表只收最好的詞根（次佳的拆法不見了）',
    file: 'src/search/derivations.js',
    find: "      if (!hit.term.includes(' ')) parses.push({ word, root, analysis: { cost: roundCost(hit.distance), steps: hit.steps, notes: [] } })\n      // 自動派生圖：BCDP 成本最低的詞庫詞根（同分全收），詞根比詞短\n      if (hit.distance > hits[0].distance + EPSILON) continue",
    replace: "      if (hit.distance > hits[0].distance + EPSILON) continue\n      if (!hit.term.includes(' ')) parses.push({ word, root, analysis: { cost: roundCost(hit.distance), steps: hit.steps, notes: [] } })",
    why: 'pakanen 的 pa-kan-en（次佳）不在拆解表；search 的 pakanen 測試、拆解表對一般搜尋的自動拆解測試',
  },
  {
    name: '句型：同位詞素組只取寫法本身',
    file: 'src/pattern/morph.js',
    find: "      return [{ type: side, forms: group, label: labelOf(side, form) }]",
    replace: "      return [{ type: side, forms: new Set([form]), label: labelOf(side, form) }]",
    why: 'mu-… 與 mi-… 結果不同；search 的同位詞素組測試',
  },
  {
    name: '句型：引號沒有關掉歸併',
    file: 'src/pattern/morph.js',
    find: '    if (quoted) return group ? [{ type: side, forms: new Set([form]), label: labelOf(side, form) }] : fail()',
    replace: '    if (quoted) return group ? [{ type: side, forms: group, label: labelOf(side, form) }] : fail()',
    why: '"mu"-… 找到 mikita；search 的引號測試',
  },
  {
    name: '句型：句末的驚嘆號也觸發句型搜尋',
    file: 'src/pattern/detect.js',
    find: String.raw`  { reason: '!', test: /(?:^|[\s(|&])!(?=[\p{L}"“(@_!^])/u },`,
    replace: "  { reason: '!', test: /!/u },",
    why: 'bunang ka lalan! 改用句型搜尋；detect 的一般搜尋清單',
  },
  {
    name: '句型：& ! 的條件被忽略',
    file: 'src/pattern/search.js',
    find: '            if (matchesAnywhere(cond.body, tokens.length, test)) return null',
    replace: '            void matchesAnywhere',
    why: 'yaku & !hapet 仍找到含 hapet 的句子；search 的 & ! 測試',
  },
  {
    name: '句型：可省略的詞也當成必經的詞篩選候選',
    file: 'src/pattern/ast.js',
    find: '      return node.min >= 1 ? requiredAtoms(node.node) : []',
    replace: '      return requiredAtoms(node.node)',
    why: 'minukan isiw? yaku 篩掉沒有 isiw 的句子；search 的候選篩選對照',
  },
]
