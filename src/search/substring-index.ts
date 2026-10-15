/**
 * @file 前綴與包含比對：「字元 → 詞」與「相鄰字元對 → 詞」反向索引。
 *
 * 加權編輯距離適合「長度相近、拼寫相近」的詞：查 `pihi` 要刪掉 3 個字元才會變成 `pihilut`，遠超過門檻；
 * 單一字母 `k` 更是無從比對。這裡補上這兩種需求：用反向索引取候選，再逐一驗證。
 */

import type { MatchType } from './scoring.ts'
import type { TermMatch } from './types.ts'

/** 每個查詢詞最多取幾個詞，避免單字母查詢產生過多結果 */
export const SUBSTRING_TERM_LIMIT = 300

export class SubstringIndex {
  /** 詞庫（FuzzyIndex）：詞表在第一次用到時才取，不在建構時就展開詞圖 */
  private readonly lexicon: { readonly terms: readonly string[]; readonly payloads: readonly unknown[][] }
  private built: { byChar: Map<string, number[]>; byPair: Map<string, number[]> } | null = null

  constructor(lexicon: { readonly terms: readonly string[]; readonly payloads: readonly unknown[][] }) {
    this.lexicon = lexicon
  }

  /** 預先建立索引（第一次查詢時本來才建立）。 */
  warmup(): void {
    this.ensure()
  }

  /**
   * 比查詢長、以查詢開頭（prefix）、以查詢結尾（suffix）或包含查詢（substring）的詞。
   * 依開頭相符、其他的順序，各自短的在前；最多 limit 個。
   */
  matches(key: string, limit = SUBSTRING_TERM_LIMIT): TermMatch[] {
    if (!key) return []
    const { terms, payloads } = this.lexicon

    // 取最少見的字元或字元對的 posting 當候選，再逐一驗證（候選的順序不影響結果：下面依長度排序）
    const candidates = this.candidates(key)

    const prefix: number[] = []
    const inner: number[] = []
    for (const id of candidates) {
      const term = terms[id]
      if (term === key || !term.includes(key)) continue
      ;(term.startsWith(key) ? prefix : inner).push(id)
    }

    // 詞越短表示多出來的部分越少，越可能是使用者要找的
    const byLength = (a: number, b: number) => terms[a].length - terms[b].length || (terms[a] < terms[b] ? -1 : 1)
    prefix.sort(byLength)
    inner.sort(byLength)

    const out: TermMatch[] = []
    for (const [ids, matchType] of [
      [prefix, 'prefix'],
      [inner, 'substring'],
    ] as Array<[number[], MatchType]>) {
      for (const id of ids) {
        if (out.length >= limit) return out
        out.push({
          term: terms[id],
          payloads: payloads[id],
          distance: 0,
          // 以查詢結尾的另外標示為結尾相符（排序與包含相同，只是可以分開篩選）
          matchType: matchType === 'substring' && terms[id].endsWith(key) ? 'suffix' : matchType,
        })
      }
    }
    return out
  }

  /**
   * 可能含有 needle 的詞編號（遞增）：needle 的每個字元與每對相鄰字元都有 posting，取最短的一個。
   * 含有 needle 的詞一定出現在每一個 posting 中，所以選哪一個都不影響驗證後的結果，只影響要驗證幾個。
   * 有字元或字元對完全沒出現過時，不可能有詞含有 needle，回傳空陣列。
   */
  private candidates(needle: string): number[] {
    const { byChar, byPair } = this.ensure()
    const chars = Array.from(needle)
    let best: number[] = []
    for (let k = 0; k < chars.length; k++) {
      const list = byChar.get(chars[k])
      if (!list) return []
      if (k === 0 || list.length < best.length) best = list
    }
    for (let k = 1; k < chars.length; k++) {
      const list = byPair.get(chars[k - 1] + chars[k])
      if (!list) return []
      if (list.length < best.length) best = list
    }
    return best
  }

  private ensure() {
    if (this.built) return this.built
    /** 字元 → 含有它的詞編號（遞增） */
    const byChar = new Map<string, number[]>()
    /** 相鄰的兩個字元 → 含有它的詞編號（遞增）；比單一字元的 posting 短得多 */
    const byPair = new Map<string, number[]>()
    const add = (map: Map<string, number[]>, keys: Iterable<string>, id: number) => {
      for (const k of keys) {
        let list = map.get(k)
        if (!list) map.set(k, (list = []))
        list.push(id)
      }
    }
    this.lexicon.terms.forEach((term, id) => {
      const chars = Array.from(term)
      add(byChar, new Set(chars), id)
      const pairs = new Set<string>()
      for (let k = 1; k < chars.length; k++) pairs.add(chars[k - 1] + chars[k])
      add(byPair, pairs, id)
    })
    this.built = { byChar, byPair }
    return this.built
  }
}
