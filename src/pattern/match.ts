/**
 * @file 句型的比對器：在一串詞（一句的一種讀法）上找出符合序列運算式的區間。
 *
 * ## 語意：與 JavaScript RegExp 的 `g` 旗標相同
 *
 * 把每個詞當成一個字元、每個 atom 當成一個字元類別，句型就是一個正規表達式：
 * `_` 是 `.`、`!x` 是 `[^x]`、`a b` 是相接、`(a|b)` 是擇一、`x*` 是貪婪的重複、`^` `$` 是頭尾。
 * 找到的區間與 RegExp 的 matchAll 完全相同：
 * 1. **最左**：從最前面的起點開始試，找到第一個能成功的起點；
 * 2. **優先序**：同一個起點有好幾種比法時，取「回溯法」最先試到的那一種：擇一依寫的順序，
 *    重複先試多的（貪婪）；
 * 3. **不重疊**：下一次從這一次的終點接著找。
 * 單元測試以隨機句型對照 RegExp 檢查這一點（test/pattern/match.test.js）。
 *
 * ## 做法：記憶化的遞迴求值（不是虛擬機器）
 *
 * `ends(節點, 起點)` 回傳這個節點從起點開始能比到的所有終點，**依優先序排列**、同一個終點只留第一次出現：
 * - atom：起點的詞符合條件時是 [起點 + 1]；
 * - 相接 a b：依序取 a 的每個終點 p，再接上 b 從 p 開始的終點；
 * - 擇一：各分支的終點依分支順序串起來；
 * - 重複：先試再多比一次（貪婪），最後才是在這裡停（次數已達下限時）。
 * 同一個終點只留第一次出現是安全的：後面的節點只看終點的位置，不看是怎麼比到的。
 * 以（節點、起點、重複次數）記憶，一句最多約 25 個詞，成本是 O(節點數 × 詞數²)。
 *
 * 區間定下來之後，`walk` 依同樣的優先序還原每一個詞是由哪一個 atom 比到的（語詞索引、頻率、說明標籤要用）。
 */

import type { AtomNode, PatternNode } from './ast.ts'

type NotNode = Extract<PatternNode, { type: 'not' }>
type RepeatNode = Extract<PatternNode, { type: 'repeat' }>
/** 區間中每個詞由哪一個 atom（或 !）比到 */
export type MatchCells = Array<{ index: number; node: AtomNode | NotNode }>
/** 第 index 個詞是否符合這個 atom */
export type AtomTest = (node: AtomNode, index: number) => boolean

export interface MatchSpan {
  /** 第一個詞的位置 */
  start: number
  /** 最後一個詞的下一個位置（[start, end)） */
  end: number
  /** 區間中每個詞由哪一個 atom（或 !）比到，依位置排列 */
  cells: MatchCells
}

/**
 * 在長度 n 的一串詞上找出所有區間。
 * @param n 詞數
 */
export function findMatches(root: PatternNode, n: number, test: AtomTest): MatchSpan[] {
  const m = createMatcher(n, test)
  const out: MatchSpan[] = []
  let pos = 0
  while (pos <= n) {
    let found = false
    for (let s = pos; s <= n; s++) {
      const es = m.ends(root, s)
      if (es.length === 0) continue
      const e = es[0]
      out.push({ start: s, end: e, cells: m.walk(root, s, e) as MatchCells })
      // 條件不會比對到空的區間（剖析時已檢查），e 一定大於 s
      pos = e > s ? e : e + 1
      found = true
      break
    }
    if (!found) break
  }
  return out
}

/** 這串詞中有沒有任何一個區間符合（不需要區間時用，例如否定的條件）。 */
export function matchesAnywhere(root: PatternNode, n: number, test: AtomTest): boolean {
  const m = createMatcher(n, test)
  for (let s = 0; s <= n; s++) if (m.ends(root, s).length > 0) return true
  return false
}

function createMatcher(n: number, test: AtomTest) {
  /** 節點的編號（記憶用的鍵） */
  const ids = new WeakMap<object, number>()
  let nextId = 0
  const idOf = (node: object) => {
    let id = ids.get(node)
    if (id === undefined) ids.set(node, (id = nextId++))
    return id
  }
  const memo = new Map<string, number[]>()

  const pushUnique = (out: number[], seen: Set<number>, xs: Iterable<number>) => {
    for (const x of xs) {
      if (seen.has(x)) continue
      seen.add(x)
      out.push(x)
    }
  }

  /** 節點從 i 開始能比到的終點，依優先序。 */
  function ends(node: PatternNode, i: number): number[] {
    const key = `${idOf(node)}:${i}`
    const hit = memo.get(key)
    if (hit) return hit
    let out: number[]
    switch (node.type) {
      case 'atom':
        out = i < n && test(node, i) ? [i + 1] : []
        break
      case 'not':
        // ! 的裡面正好佔一個詞（剖析時已檢查）：這個詞不符合時才算
        out = i < n && !ends(node.node, i).includes(i + 1) ? [i + 1] : []
        break
      case 'anchor':
        out = (node.at === 'start' ? i === 0 : i === n) ? [i] : []
        break
      case 'seq': {
        let cur = [i]
        for (const item of node.items) {
          const next: number[] = []
          const seen = new Set<number>()
          for (const p of cur) pushUnique(next, seen, ends(item, p))
          cur = next
          if (cur.length === 0) break
        }
        out = cur
        break
      }
      case 'alt': {
        out = []
        const seen = new Set<number>()
        for (const o of node.options) pushUnique(out, seen, ends(o, i))
        break
      }
      case 'repeat':
        out = repeatEnds(node, i, 0)
        break
    }
    memo.set(key, out)
    return out
  }

  /**
   * 重複：已經比了 count 次，從 i 開始。貪婪：先試再多比一次（每次至少前進一個詞），最後才是停在 i。
   * 沒有上限時，count 超過下限之後行為都一樣，記憶的鍵把它併成下限。
   */
  function repeatEnds(node: RepeatNode, i: number, count: number): number[] {
    const c = node.max === Infinity ? Math.min(count, node.min) : count
    const key = `${idOf(node)}:${i}:r${c}`
    const hit = memo.get(key)
    if (hit) return hit
    const out: number[] = []
    const seen = new Set<number>()
    if (count < node.max) {
      for (const e of ends(node.node, i)) {
        if (e > i) pushUnique(out, seen, repeatEnds(node, e, count + 1))
      }
    }
    if (count >= node.min) pushUnique(out, seen, [i])
    memo.set(key, out)
    return out
  }

  /**
   * 依優先序還原「從 i 比到 e」的那一種比法中，每個詞由哪一個 atom 比到。
   * 取的是 ends 列出 e 時最先試到的比法，與 RegExp 的回溯順序相同。
   * @returns 不可能比到 e 時為 null
   */
  function walk(node: PatternNode, i: number, e: number): MatchCells | null {
    if (!ends(node, i).includes(e)) return null
    switch (node.type) {
      case 'atom':
      case 'not':
        return [{ index: i, node }]
      case 'anchor':
        return []
      case 'seq':
        return walkSeq(node.items, 0, i, e)
      case 'alt':
        // 第一個能比到 e 的分支（分支依寫的順序試）
        for (const o of node.options) if (ends(o, i).includes(e)) return walk(o, i, e)
        return null
      case 'repeat':
        return walkRepeat(node, i, e, 0)
    }
  }

  /** 相接的第 k 項起，從 p 比到 e。依 items[k] 終點的優先序，取第一個「後面接得到 e」的終點。 */
  function walkSeq(items: PatternNode[], k: number, p: number, e: number): MatchCells | null {
    if (k === items.length) return p === e ? [] : null
    for (const m of ends(items[k], p)) {
      if (!tailEnds(items, k + 1, m).includes(e)) continue
      const head = walk(items[k], p, m)
      const tail = walkSeq(items, k + 1, m, e)
      if (head && tail) return [...head, ...tail]
    }
    return null
  }

  /** 相接的第 k 項起，從 p 能比到的終點（walkSeq 判斷後面接不接得到用）。 */
  function tailEnds(items: PatternNode[], k: number, p: number): number[] {
    let cur = [p]
    for (let j = k; j < items.length; j++) {
      const next: number[] = []
      const seen = new Set<number>()
      for (const q of cur) pushUnique(next, seen, ends(items[j], q))
      cur = next
    }
    return cur
  }

  function walkRepeat(node: RepeatNode, i: number, e: number, count: number): MatchCells | null {
    if (count < node.max) {
      for (const m of ends(node.node, i)) {
        if (m <= i || !repeatEnds(node, m, count + 1).includes(e)) continue
        const head = walk(node.node, i, m)
        const tail = walkRepeat(node, m, e, count + 1)
        if (head && tail) return [...head, ...tail]
      }
    }
    return count >= node.min && i === e ? [] : null
  }

  return { ends, walk }
}
