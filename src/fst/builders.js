/**
 * @file 實驗性：把 babizu 的語言設定檔建成 WFST，求「音變 ∘ 構詞 ∘ 詞庫」的真正聯合最佳解 W*。
 *
 * - E（`editTransducer`）：查詢拼寫 → 標準拼寫。花形轉錄器：替換、刪除、插入，加上每條方言規則的路徑
 *   （多字元規則以中間狀態展開）。詞首規則只能從起始狀態出發；詞尾規則走完後進入不能再有任何輸入輸出的狀態。
 * - S（`surfaceLexicon`）：所有「前綴鏈 · 詞幹（可含 Ca 重疊、中綴、詞幹交替）· 後綴鏈」的表面詞形，
 *   權重是構詞步驟的成本；詞幹取自詞庫的詞圖（DAWG），惰性展開。
 * - W*(q) ＝ q ∘ E ∘ S 的最短路徑（`fstLemmaSearch`）。
 *
 * 限制（與 babizu 的 DP 相同或更寬）：
 * - 只處理單詞（詞中的空白不當作詞邊界）
 * - 詞幹交替只支援單一字元的 underlying／surface
 * - 重疊只支援 Ca；CV、CVV、CVCV、CVCVC 在有限詞庫上雖然可以展開，但這個參考實作沒有做，
 *   完整重疊也一樣（詞庫有限，{red(t)·t} 是有限集合）。遇到這些型式會丟出 RangeError，不會默默略過（呼叫端要先去掉它們）
 *
 * 這是評估用的參考實作，不追求速度：狀態以字串為鍵、以雜湊表記錄。
 */

import { compose, EPS, shortestDistance, stringAcceptor } from './wfst.js'

/**
 * 方言規則與編輯成本 → 加權轉錄器 E。
 * @param {import('../fuzzy/distance.js').WeightedEditDistance} metric
 * @param {Iterable<string>} alphabet 標準拼寫可能出現的所有字元（詞庫與詞綴的字元）
 * @returns {import('./wfst.js').Wfst}
 */
export function editTransducer(metric, alphabet) {
  const { compiled, costs } = metric
  const sigma = [...new Set(alphabet)]
  const rules = compiled.rules.map((r) => ({
    source: Array.from(r.source),
    target: Array.from(r.target),
    weight: r.weight,
    position: r.position,
  }))
  /** @type {Map<string, number[]>} 規則 source 的第一個字元 → 規則編號 */
  const bySourceHead = new Map()
  /** @type {number[]} source 為空的規則（純插入型） */
  const emptySource = []
  rules.forEach((r, idx) => {
    if (r.source.length === 0) emptySource.push(idx)
    else {
      const list = bySourceHead.get(r.source[0]) ?? []
      list.push(idx)
      bySourceHead.set(r.source[0], list)
    }
  })

  /** 規則走完之後的狀態：詞尾規則進入 E（不能再有任何輸入輸出），其他回到 M @param {number} idx */
  const done = (idx) => (rules[idx].position === 'final' ? 'E' : 'M')
  /** source 消耗完之後：還有 target 要輸出就進入 T 狀態，否則規則結束 @param {number} idx */
  const afterSource = (idx) => (rules[idx].target.length > 0 ? `T${idx}.0` : done(idx))

  return {
    start: 'S',
    key: (s) => s,
    final: (s) => (s === 'S' || s === 'M' || s === 'E' ? 0 : Infinity),
    arcs() {
      throw new Error('editTransducer 只支援以 arcsWithInput／epsInputArcs 組合')
    },
    arcsWithInput(s, x) {
      /** @type {import('./wfst.js').Arc[]} */
      const out = []
      if (s === 'S' || s === 'M') {
        for (const y of sigma) out.push({ i: x, o: y, w: costs.sub(x, y), to: 'M' })
        out.push({ i: x, o: EPS, w: costs.del(x), to: 'M' })
        for (const idx of bySourceHead.get(x) ?? []) {
          const r = rules[idx]
          if (r.position === 'initial' && s !== 'S') continue
          out.push({ i: x, o: EPS, w: r.weight, to: r.source.length === 1 ? afterSource(idx) : `R${idx}.1` })
        }
      } else if (s[0] === 'R') {
        const [idx, k] = s.slice(1).split('.').map(Number)
        const r = rules[idx]
        if (r.source[k] === x) out.push({ i: x, o: EPS, w: 0, to: k + 1 === r.source.length ? afterSource(idx) : `R${idx}.${k + 1}` })
      }
      return out
    },
    epsInputArcs(s) {
      /** @type {import('./wfst.js').Arc[]} */
      const out = []
      if (s === 'S' || s === 'M') {
        for (const y of sigma) out.push({ i: EPS, o: y, w: costs.ins(y), to: 'M' })
        for (const idx of emptySource) {
          const r = rules[idx]
          if (r.position === 'initial' && s !== 'S') continue
          out.push({ i: EPS, o: r.target[0], w: r.weight, to: r.target.length === 1 ? done(idx) : `T${idx}.1` })
        }
      } else if (s[0] === 'T') {
        const [idx, k] = s.slice(1).split('.').map(Number)
        const r = rules[idx]
        out.push({ i: EPS, o: r.target[k], w: 0, to: k + 1 === r.target.length ? done(idx) : `T${idx}.${k + 1}` })
      }
      return out
    },
  }
}

/**
 * @typedef {object} TrieNode
 * @property {Map<string, number>} children
 * @property {Array<{form: string, cost: number}>} ends 在這裡結束的詞綴
 */

/** @param {Array<{form: string, cost: number}>} affixes */
function buildTrie(affixes) {
  /** @type {TrieNode[]} */
  const nodes = [{ children: new Map(), ends: [] }]
  for (const a of affixes) {
    let node = 0
    for (const ch of Array.from(a.form)) {
      let next = nodes[node].children.get(ch)
      if (next === undefined) {
        next = nodes.length
        nodes.push({ children: new Map(), ends: [] })
        nodes[node].children.set(ch, next)
      }
      node = next
    }
    nodes[node].ends.push(a)
  }
  return nodes
}

/**
 * 表面詞形接受器 S：前綴鏈 · 詞幹 · 後綴鏈（輸入＝輸出），權重為構詞步驟的成本。
 *
 * @param {object} options
 * @param {import('../fuzzy/dawg.js').Dawg} options.dawg 詞幹的詞圖
 * @param {(base: number) => boolean} [options.accept] 詞幹（依詞圖名次）是否可用，例如只收詞條身分的詞
 * @param {import('../fuzzy/morphology.js').Analyzer['spec']} options.spec 已正規化的構詞規格
 * @param {boolean} [options.requireStep=true] 至少要有一個構詞步驟（沒有步驟的是普通模糊命中）
 * @returns {import('./wfst.js').Wfst}
 */
export function surfaceLexicon({ dawg, accept = () => true, spec, requireStep = true }) {
  const prefixTrie = buildTrie(spec.prefixes)
  const suffixTrie = buildTrie(spec.suffixes)
  const infixTrie = buildTrie(spec.infixes)
  const vowels = new Set(Array.from(spec.vowels))
  const slots = spec.maxSteps
  // 只支援 Ca 重疊與單一字元的詞幹交替。其他型式（CV、CVV、CVCV、CVCVC、full）與多字元交替
  // 若默默略過，求得的 W* 就與 BCDP 的語意不同而不自知，所以明確丟出錯誤，由呼叫端決定是否先去掉它們。
  for (const r of spec.reduplication) {
    if (r.pattern !== 'Ca') throw new RangeError(`surfaceLexicon 不支援重疊型式 ${r.pattern}（只支援 Ca）`)
  }
  for (const a of spec.alternations) {
    if (Array.from(a.underlying).length !== 1 || Array.from(a.surface).length !== 1) {
      throw new RangeError(`surfaceLexicon 只支援單一字元的詞幹交替（${a.underlying}>${a.surface}）`)
    }
    if (a.position === 'initial') throw new RangeError(`surfaceLexicon 只支援詞素末的構詞音變（${a.underlying}>${a.surface}）`)
  }
  const ca = spec.reduplication.find((r) => r.pattern === 'Ca')
  const alternations = spec.alternations
  /** @type {Map<string, import('./wfst.js').Arc[]>} 出弧的快取（同一個狀態常被組合重複詢問） */
  const cache = new Map()

  /**
   * 狀態以陣列表示，第一個元素是階段：
   * - ['P', 已用槽位, trie 節點, 步驟數]                        前綴鏈
   * - ['B', 步驟數]                                              詞幹開始
   * - ['RA', 首輔音, 步驟數]、['RF', 首輔音, 步驟數]             Ca 重疊：已輸出首輔音、已輸出 a
   * - ['D', 詞圖節點, 名次, 深度, 仍在首輔音, 已用中綴, 需要元音, 步驟數]   詞幹
   * - ['I', 中綴 trie 節點, 詞圖節點, 名次, 深度, 步驟數]        中綴
   * - ['S', 已用槽位, trie 節點, 名次, 步驟數, 限制的後綴]      後綴鏈
   */
  const key = (/** @type {any[]} */ s) => s.join('|')

  /** @param {any[]} s @returns {import('./wfst.js').Arc[]} */
  function compute(s) {
    /** @type {import('./wfst.js').Arc[]} */
    const out = []
    const eps = (/** @type {number} */ w, /** @type {any[]} */ to) => out.push({ i: EPS, o: EPS, w, to })
    const sym = (/** @type {string} */ c, /** @type {number} */ w, /** @type {any[]} */ to) => out.push({ i: c, o: c, w, to })
    switch (s[0]) {
      case 'P': {
        const [, used, t, steps] = s
        for (const [c, child] of prefixTrie[t].children) sym(c, 0, ['P', used, child, steps])
        if (t === 0 && used === 0) eps(0, ['B', steps])
        for (const a of prefixTrie[t].ends) {
          if (used + 1 < slots) eps(a.cost, ['P', used + 1, 0, steps + 1])
          eps(a.cost, ['B', steps + 1])
        }
        break
      }
      case 'B': {
        const [, steps] = s
        eps(0, ['D', dawg.root, 0, 0, 1, 0, 0, steps])
        if (ca) {
          // 輸出詞幹首輔音＋a，之後詞幹必須以同一個輔音開始；元音開頭的詞幹只重疊 a
          const firsts = new Set()
          for (let e = dawg.firstEdge(dawg.root); e < dawg.endEdge(dawg.root); e++) firsts.add(dawg.label(e))
          for (const c of firsts) {
            if (vowels.has(c)) continue
            sym(c, ca.cost, ['RA', c, steps + 1])
          }
          sym('a', ca.cost, ['RF', '', steps + 1])
        }
        break
      }
      case 'RA':
        sym('a', 0, ['RF', s[1], s[2]])
        break
      case 'RF': {
        const [, c, steps] = s
        for (let e = dawg.firstEdge(dawg.root); e < dawg.endEdge(dawg.root); e++) {
          const label = dawg.label(e)
          if (c ? label !== c : !vowels.has(label)) continue
          sym(label, 0, ['D', dawg.target(e), dawg.wordsBefore(e), 1, c ? 1 : 0, 0, 0, steps])
        }
        break
      }
      case 'D': {
        const [, node, base, depth, inOnset, usedInfix, needVowel, steps] = s
        for (let e = dawg.firstEdge(node); e < dawg.endEdge(node); e++) {
          const c = dawg.label(e)
          const isVowel = vowels.has(c)
          if (needVowel && !isVowel) continue
          const target = dawg.target(e)
          const nextBase = base + dawg.wordsBefore(e)
          sym(c, 0, ['D', target, nextBase, depth + 1, inOnset && !isVowel ? 1 : 0, usedInfix, 0, steps])
          // 構詞音變：詞幹最後一個字元（underlying）寫成 surface，之後必須接後綴（詞素交界）。
          // E 看不到詞素交界，所以在 S 中以「詞幹結尾的另一種寫法」表示；它是規則，不另外算一個步驟
          if (dawg.isFinal(target) && depth + 1 >= spec.minStem && accept(nextBase)) {
            for (const a of alternations) {
              if (a.underlying !== c) continue
              sym(a.surface, a.cost, ['S', 0, 0, nextBase, steps, '*'])
            }
          }
        }
        // 中綴：首輔音（群）之後、首元音之前
        if (inOnset && !usedInfix) eps(0, ['I', 0, node, base, depth, steps])
        // 詞幹結束
        if (dawg.isFinal(node) && depth >= spec.minStem && accept(base) && !needVowel) eps(0, ['S', 0, 0, base, steps, ''])
        break
      }
      case 'I': {
        const [, t, node, base, depth, steps] = s
        for (const [c, child] of infixTrie[t].children) sym(c, 0, ['I', child, node, base, depth, steps])
        for (const x of infixTrie[t].ends) eps(x.cost, ['D', node, base, depth, 0, 1, 1, steps + 1])
        break
      }
      case 'S': {
        const [, used, t, base, steps, restrict] = s
        if (used < slots) for (const [c, child] of suffixTrie[t].children) sym(c, 0, ['S', used, child, base, steps, restrict])
        for (const b of suffixTrie[t].ends) {
          if (restrict && restrict !== '*' && !restrict.split(',').includes(b.form)) continue
          eps(b.cost, ['S', used + 1, 0, base, steps + 1, ''])
        }
        break
      }
    }
    return out
  }

  return {
    start: ['P', 0, 0, 0],
    key,
    final: (s) => (s[0] === 'S' && s[2] === 0 && !s[5] && (!requireStep || s[4] >= 1) ? 0 : Infinity),
    arcs(s) {
      const k = key(s)
      let arcs = cache.get(k)
      if (!arcs) cache.set(k, (arcs = compute(s)))
      return arcs
    },
    arcsWithInput(s, label) {
      return this.arcs(s).filter((a) => a.i === label)
    },
    epsInputArcs(s) {
      return this.arcs(s).filter((a) => a.i === EPS)
    },
  }
}

/**
 * q ∘ E ∘ S 的有界最短路徑：列出所有 W*(q, t) ≤ bound 的詞幹 t。
 *
 * @param {object} deps
 * @param {import('./wfst.js').Wfst} deps.E
 * @param {import('./wfst.js').Wfst} deps.S
 * @param {(base: number) => string} deps.termAt 詞圖名次 → 詞
 * @param {string} query 已正規化的查詢
 * @param {{bound: number}} options
 * @returns {{hits: Map<string, number>, expanded: number}}
 */
export function fstLemmaSearch({ E, S, termAt }, query, { bound }) {
  const machine = compose(stringAcceptor(Array.from(query)), compose(E, S))
  /** @type {Map<string, number>} */
  const hits = new Map()
  const { expanded } = shortestDistance(machine, {
    bound,
    onFinal: (state, cost) => {
      const term = termAt(state.b.b[3])
      const c = Math.round(cost * 1e9) / 1e9
      if (!(hits.get(term) <= c)) hits.set(term, c)
    },
  })
  return { hits, expanded }
}
