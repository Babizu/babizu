/**
 * 構詞搜尋的性質測試：仿巴宰語的構詞文法、隨機詞根、依規則與不依規則的詞綴組合（test/search/morph-corpus.js），
 * 檢查正確性、對稱性與一致性。都在詞的層級比（_matchTerms），不經過記錄的合併與上限。
 *
 * - 正確性：依規則的衍生詞，詞根在詞庫中時，拆解表中有這個詞根，成本不超過真正的推導（交界的構詞音變也算）。
 * - 對稱：自動派生圖上有共同詞根（兩條邊的音變都不超過 SIBLING_MAX_SOUND）的兩個詞，查 a 找得到 b 就要查 b 也找得到 a，
 *   詞根在詞庫中或是虛擬詞根都一樣；兩個方向的自動同根分數相同。
 * - 一致：查詢端拆出的虛擬詞根與建置時相同（兩端用同一個函式、同一個「詞庫中最好的詞根」的定義）；
 *   拆解表與一般搜尋的自動拆解相同。
 * 研究紀錄 U.24：這組測試找出了「查詢本身是別的詞的詞根時，連詞庫詞根的同根也不找」（真實資料上 33% 的同根對不對稱）
 * 與「查詢端的詞庫最好成本含詞根不比詞短的命中」（虛擬詞根兩端不一致）。
 */

import { describe, expect, it } from 'vitest'
import { FUZZINESS } from '../../src/search/index.js'
import { isLexicalRoot, SIBLING_MAX_SOUND, soundOf } from '../../src/search/derivations.js'
import { buildMorphEngine, morphCorpus } from './morph-corpus.js'

const EPS = 1e-9
const SEEDS = [11, 12, 13]

for (const seed of SEEDS) {
  describe(`種子 ${seed}`, () => {
    const { lexical, derivations, records } = morphCorpus(seed, 50)
    const { engine } = buildMorphEngine(records)
    const e = /** @type {any} */ (engine)
    const index = e.index
    const graph = e.derivations
    const chart = e.parses
    const terms = /** @type {string[]} */ (index.terms)
    /** @type {Map<string, Map<string, number>>} */
    const memo = new Map()
    /** 詞層級的命中：詞 → 分數（標準模式） @param {string} q */
    const hits = (q) => {
      let m = memo.get(q)
      if (!m) memo.set(q, (m = new Map(e._matchTerms(q, FUZZINESS.normal, { stats: { visitedNodes: 0 } }).map((/** @type {any} */ h) => [h.term, h]))))
      return m
    }
    const words = derivations.map((d) => d.word).filter((w) => index.dawg.lookup(w) !== -1)

    // 自動派生圖的邊（與 DerivationGraph 相同的定義）：詞庫詞根 → 子詞、虛擬詞根 → 子詞
    /** @type {Map<string, number[]>} */
    const kids = new Map()
    for (const w of words) {
      const id = index.dawg.lookup(w)
      const best = chart.lexicalBestOf(id)
      for (const p of chart.of(id)) {
        if (!p.virtual && (p.cost > best + EPS || soundOf(p) > SIBLING_MAX_SOUND + EPS)) continue
        const k = `${p.virtual ? 'v' : 'l'}:${p.root}`
        kids.set(k, [...new Set([...(kids.get(k) ?? []), id])])
      }
    }

    it('正確性：依規則的衍生詞找得到詞庫中的詞根，成本不超過真正的推導', () => {
      const bad = []
      for (const d of derivations) {
        if (!d.regular || !lexical.has(d.root) || d.cost > 1) continue
        const id = index.dawg.lookup(d.word)
        const ps = id === -1 ? [] : chart.of(id)
        const best = id === -1 ? Infinity : chart.lexicalBestOf(id)
        // 真正的推導比最好的分析貴太多時（超出 lemmaSpread），本來就不列
        if (d.cost > best + 0.6 + EPS) continue
        const hit = ps.find((/** @type {any} */ p) => !p.virtual && p.root === d.root)
        if (!hit || hit.cost > d.cost + EPS) bad.push(`${d.word}（${d.root}，${d.cost}）：${hit ? hit.cost : '找不到'}`)
      }
      expect(bad).toEqual([])
    })

    it('同根對稱：有共同詞根的兩個詞，查 a 找得到 b 就要查 b 也找得到 a（詞庫詞根與虛擬詞根）', () => {
      const bad = []
      for (const [k, ids] of kids) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = terms[ids[i]]
            const b = terms[ids[j]]
            if (hits(a).has(b) !== hits(b).has(a)) bad.push(`${k}：${a} ${hits(a).has(b) ? '→' : '↛'} ${b}，${b} ${hits(b).has(a) ? '→' : '↛'} ${a}`)
          }
        }
      }
      expect(bad).toEqual([])
    })

    it('同根分數對稱：查 a 得到 b 的自動同根分數，等於查 b 得到 a 的', () => {
      const bad = []
      for (const a of words) {
        for (const [b, h] of hits(a)) {
          if (h.matchType !== 'sibling') continue
          const back = hits(b).get(a)
          if (back?.matchType === 'sibling' && Math.abs(back.distance - h.distance) > EPS) bad.push(`${a} → ${b} ${h.distance}，${b} → ${a} ${back.distance}`)
        }
      }
      expect(bad).toEqual([])
    })

    it('一致：查詢端拆出的虛擬詞根與建置時相同', () => {
      const ms = e.morphSearch
      const level = e._level('normal')
      const bad = []
      for (const w of words) {
        const id = index.dawg.lookup(w)
        if (isLexicalRoot(index, id, (/** @type {number} */ x) => graph.hasChildren(x))) continue
        const built = chart.of(id).filter((/** @type {any} */ p) => p.virtual).map((/** @type {any} */ p) => p.root).sort()
        // 與 _derivedTerms 相同的計算：查詢的自動拆解 → 詞庫中最好的詞根的成本 → virtualRoots
        const prepared = ms.seed(ms.prepare(w, e._lemmaMax(w, level)), index)
        const lemma = prepared ? e._lemmaTerms(w, level, prepared, index.searchChannels(prepared.channels)) : []
        const atQuery = e._queryVirtualRoots(w, lemma)
          .map((/** @type {any} */ v) => v.stem)
          .sort()
        if (built.join() !== atQuery.join()) bad.push(`${w}：建置 ${built.join(',') || '—'}，查詢 ${atQuery.join(',') || '—'}`)
      }
      expect(bad).toEqual([])
    })

    it('同分的讀法：同一個詞、同一個詞根、同樣成本的幾種讀法，步驟成本都相同（音變的分量相同）', () => {
      // 研究紀錄 U.25：多一個步驟、少一些音變的讀法總成本相同，卻能鑽過精確模式的音變上限（morohot 的 m- ＋ o~ ＋ ruhut）
      const bad = []
      for (const w of words) {
        /** @type {Map<string, number>} */
        const stepCost = new Map()
        for (const p of chart.of(index.dawg.lookup(w))) {
          const k = `${p.root}\u0000${p.cost}\u0000${p.virtual}`
          const s = Math.round(p.steps.reduce((/** @type {number} */ x, /** @type {any} */ st) => x + st.cost, 0) * 1e6) / 1e6
          if (stepCost.has(k) && stepCost.get(k) !== s) bad.push(`${w} → ${p.root}@${p.cost}：步驟成本 ${stepCost.get(k)} 與 ${s}`)
          stepCost.set(k, s)
        }
      }
      expect(bad).toEqual([])
    })

    it('一致：拆解表與一般搜尋的自動拆解相同（詞根比詞短、單一個詞）', () => {
      const ms = e.morphSearch
      const level = e._level('normal')
      const bad = []
      for (const w of words) {
        const prepared = ms.seed(ms.prepare(w, e._lemmaMax(w, level)), index)
        const lemma = prepared ? e._lemmaTerms(w, level, prepared, index.searchChannels(prepared.channels)) : []
        const fromSearch = lemma
          .filter((/** @type {any} */ m) => m.term.length < w.length && !m.term.includes(' '))
          .map((/** @type {any} */ m) => `${m.term}:${m.distance}`)
          .sort()
        // 同一個詞根成本相同的幾種讀法（ties）各一筆：比（詞根、成本）的集合
        const fromChart = [...new Set(chart.of(index.dawg.lookup(w)).filter((/** @type {any} */ p) => !p.virtual).map((/** @type {any} */ p) => `${p.root}:${p.cost}`))].sort()
        if (fromSearch.join() !== fromChart.join()) bad.push(`${w}：搜尋 ${fromSearch.join(' ')}；拆解表 ${fromChart.join(' ')}`)
      }
      expect(bad).toEqual([])
    })
  })
}
