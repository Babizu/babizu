/**
 * @file 對應組檢索的學習：由對齊的同源詞對數出對應組，並歸納「前後文單位」（docs/csr.md 第 5 節）。
 *
 * 只用資料，不收任何手寫規則。輸入是兩個方言的對齊詞對（例如 LingPy 的 LexStat 判為同源、兩兩對齊的結果），
 * 每一欄是 [第一個方言的音段或 '-', 第二個方言的音段或 '-']。
 *
 * 1. 單一音段的對應組：每一欄（x, y）數一次。
 * 2. 前後文單位：二到 maxColumns 欄的連續欄（至少一欄兩邊不同）；沒修剪的一端多一個「詞界欄」，含詞界的單位只在詞首或詞尾成立。
 *    - 支持度：單位出現的詞對中，兩個方言各有幾個不同的詞，取小的；至少 minSupport，一個詞造不出單位；
 *    - 增益 ＝ Σ 出現處（這幾欄以目前單一音段的模型算的成本 − 單位的成本）− penalty。
 *      成本都是兩個方向的 −log 條件機率相加；單位的分母是來源字串在那個方言出現的次數；
 *    - 每次挑增益最大的單位，把它出現處的欄從單一音段的計數拿掉（「解釋掉」），重算，直到沒有正的增益。
 *    例：r : w 只在 u 之後出現時，這幾欄被「ur → ow」解釋掉，剩下的 r : w 不到 minSites 欄，就不再是不看前後文的對應。
 *    這是硬指派（Viterbi 式）的多對多對齊歸納（m2m-aligner，Jiampojamarn et al. 2007），加上每個單位的描述長度懲罰
 *    （最小描述長度，同 Morfessor，Creutz & Lagus 2007）。
 * 3. 選用（poolVowels）：以 Sukhotin 演算法從資料的分布分出元音（Sukhotin 1962；Guy 1991），
 *    單位頭尾那一欄的某一邊是元音時，也試著把「那一邊是任何元音」的幾個單位合成一個家族（例如 ?ra → owa：ura、ara 都對到 owa），
 *    支持度與成本都以整個家族計算；家族中實際出現過的每個單位各寫一條，sites 與分母（of）是整個家族的。
 */

import { occurrenceKey, type CsrPattern } from './model.ts'

const GAP = '-'

/** 兩個方言的一對對齊的詞 */
export interface CsrAlignedPair {
  /** 兩個方言的詞形（算支持度用：不同的詞有幾個） */
  forms: [string, string]
  /** 對齊的欄：[第一個方言的音段或 '-', 第二個方言的音段或 '-'] */
  cols: Array<[string, string]>
  /** 兩端修剪掉的欄數（例如像詞綴的缺口段）：修剪掉的欄不學，修剪過的一端也不算詞界 */
  cut?: [number, number]
}

export interface CsrLearnOptions {
  /** 前後文單位最多幾欄（不含詞界欄；預設 3） */
  maxColumns?: number
  /** 兩個方言各至少幾個不同的詞（預設 2） */
  minSupport?: number
  /** 每個單位的描述長度懲罰（nats；預設 16，在巴宰–噶哈巫語的兩折評估上選的） */
  penalty?: number
  /** 以學出的元音類合併頭尾的前後文（預設 false） */
  poolVowels?: boolean
  /** 與執行期相同：對應組至少要有幾欄才使用（預設 2） */
  minSites?: number
  /** 與執行期相同：兩邊相同的平滑（預設 1） */
  beta?: number
  /** 與執行期相同：沒見過的差異每個音段的成本（預設 4） */
  typo?: number
  /** 最多學幾個單位（預設 1000） */
  maxUnits?: number
}

/** 學到的一個前後文單位（報告用；含例詞，不要放進公開的模型） */
export interface CsrLearnedUnit {
  /** 家族的寫法：? 是任何元音 */
  reflexes: Record<string, string>
  position?: 'initial' | 'final'
  /** 家族中實際出現過的單位（不是家族時只有一個） */
  members: Array<Record<string, string>>
  sites: number
  support: number
  gain: number
  /** 兩個方向的成本（第一個方言 → 第二個、反過來） */
  cost: [number, number]
  examples: Array<[string, string]>
}

export interface CsrLearned {
  /** 單一音段的對應組（解釋掉之後剩下的欄）與前後文單位 */
  patterns: CsrPattern[]
  /** 前後文單位兩邊的出現次數 */
  occurrences: Record<string, Record<string, number>>
  /** 依挑選的順序 */
  units: CsrLearnedUnit[]
  /** poolVowels 時學出的元音 */
  vowels?: string[]
}

type Col = [string, string] | null // null 是詞界欄
type Occ = [number, number, number] // [詞對, 開始, 欄數]

interface Candidate {
  /** 家族的寫法（? 是任何元音）；不是家族時就是單位本身 */
  src: string
  tgt: string
  position?: 'initial' | 'final'
  family: boolean
  occ: Occ[]
  done: boolean
}

/**
 * Sukhotin 的元音辨識：字母相鄰的對稱矩陣，每次把「與其他輔音相鄰最多」的字母當作元音，
 * 再扣掉其他字母與它相鄰的次數，直到沒有正的列和（Sukhotin 1962；Guy 1991）。只用資料的分布。
 */
export function sukhotinVowels(words: readonly string[][]): Set<string> {
  const letters = [...new Set(words.flat())].sort()
  const idx = new Map(letters.map((l, k) => [l, k]))
  const n = letters.length
  const M = Array.from({ length: n }, () => new Float64Array(n))
  for (const w of words)
    for (let i = 0; i + 1 < w.length; i++) {
      const a = idx.get(w[i]) as number, b = idx.get(w[i + 1]) as number
      if (a !== b) {
        M[a][b]++
        M[b][a]++
      }
    }
  const sum = M.map((row) => row.reduce((s, x) => s + x, 0))
  const vowel = new Uint8Array(n)
  for (;;) {
    let best = -1
    for (let i = 0; i < n; i++) if (!vowel[i] && sum[i] > 0 && (best < 0 || sum[i] > sum[best])) best = i
    if (best < 0) break
    vowel[best] = 1
    for (let j = 0; j < n; j++) if (!vowel[j]) sum[j] -= 2 * M[j][best]
  }
  return new Set(letters.filter((_, i) => vowel[i]))
}

export function learnCorrespondences(dialects: [string, string], pairs: readonly CsrAlignedPair[], options: CsrLearnOptions = {}): CsrLearned {
  const { maxColumns = 3, minSupport = 2, penalty = 16, poolVowels = false, minSites = 2, beta = 1, typo = 4, maxUnits = 1000 } = options
  const seqs: Col[][] = pairs.map((p) => {
    const [lo, hi] = p.cut ?? [0, 0]
    const core: Col[] = p.cols.slice(lo, p.cols.length - hi)
    return [...(lo === 0 ? [null] : []), ...core, ...(hi === 0 ? [null] : [])]
  })
  const tokens = new Set<string>()
  for (const s of seqs) for (const c of s) if (c) for (const t of c) if (t !== GAP) tokens.add(t)
  const vowels = poolVowels
    ? sukhotinVowels(seqs.flatMap((s) => ([0, 1] as const).map((k) => s.filter((c): c is [string, string] => c !== null && c[k] !== GAP).map((c) => c[k]))))
    : new Set<string>()

  // 每個方言的字串出現次數（連續的音段；詞首 ^、詞尾 $；空字串是可以插入的位置數）
  const occ: [Map<string, number>, Map<string, number>] = [new Map(), new Map()]
  const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n)
  for (const s of seqs)
    for (const k of [0, 1] as const) {
      const lead = s[0] === null, trail = s[s.length - 1] === null
      const toks = s.filter((c): c is [string, string] => c !== null && c[k] !== GAP).map((c) => c[k])
      bump(occ[k], '', toks.length + 1)
      if (lead) bump(occ[k], '^')
      if (trail) bump(occ[k], '$')
      for (let i = 0; i < toks.length; i++)
        for (let l = 1; l <= maxColumns && i + l <= toks.length; l++) {
          const key = toks.slice(i, i + l).join('')
          bump(occ[k], key)
          if (lead && i === 0) bump(occ[k], `^${key}`)
          if (trail && i + l === toks.length) bump(occ[k], `${key}$`)
        }
    }

  /** 一個出現處的兩邊字串與位置 */
  const memberOf = ([si, i, L]: Occ) => {
    const span = seqs[si].slice(i, i + L)
    const real = span.filter((c): c is [string, string] => c !== null)
    const position = span[0] === null ? 'initial' : span[span.length - 1] === null ? 'final' : undefined
    return { real, position, src: real.map((c) => c[0]).filter((t) => t !== GAP).join(''), tgt: real.map((c) => c[1]).filter((t) => t !== GAP).join('') } as const
  }
  const sideString = (real: Array<[string, string]>, k: 0 | 1, wild: number) => real.map((c, n) => (n === wild ? '?' : c[k])).filter((t) => t !== GAP).join('')

  // 候選：連續欄（可以帶一個詞界欄），至少一欄兩邊不同；兩邊都只是單一音段（或缺口）且沒有位置的不算（那是單一音段的對應）
  const cands = new Map<string, Candidate>()
  const add = (key: string, make: () => Omit<Candidate, 'occ' | 'done'>, o: Occ) => {
    let c = cands.get(key)
    if (!c) cands.set(key, (c = { ...make(), occ: [], done: false }))
    c.occ.push(o)
  }
  seqs.forEach((s, si) => {
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j <= s.length; j++) {
        const o: Occ = [si, i, j - i]
        const { real, position, src, tgt } = memberOf(o)
        if (real.length > maxColumns) break
        if (real.length === 0 || (s[i] === null && s[j - 1] === null) || !real.some(([x, y]) => x !== y)) continue
        const single = (x: string) => x === '' || tokens.has(x)
        if (!position && single(src) && single(tgt)) continue
        add(`${position ?? ''}|${src}|${tgt}`, () => ({ src, tgt, position, family: false }), o)
        // 家族：頭或尾那一欄的某一邊是元音時，那一邊換成「任何元音」
        if (poolVowels && real.length >= 2)
          for (const n of new Set([0, real.length - 1]))
            for (const k of [0, 1] as const) {
              if (!vowels.has(real[n][k])) continue
              const fs = k === 0 ? sideString(real, 0, n) : src, ft = k === 1 ? sideString(real, 1, n) : tgt
              add(`F${position ?? ''}|${fs}|${ft}`, () => ({ src: fs, tgt: ft, position, family: true }), o)
            }
      }
  })

  // 已被單位解釋掉的欄
  const covered = seqs.map((s) => new Uint8Array(s.length))
  const isFree = ([si, i, L]: Occ) => {
    for (let k = i; k < i + L; k++) if (covered[si][k]) return false
    return true
  }
  const supportOf = (os: Occ[]) => Math.min(new Set(os.map((o) => pairs[o[0]].forms[0])).size, new Set(os.map((o) => pairs[o[0]].forms[1])).size)

  /** 目前（沒被解釋掉的欄）的單一音段模型：一欄兩個方向的成本相加 */
  const unigram = () => {
    const c = new Map<string, number>(), r0 = new Map<string, number>(), r1 = new Map<string, number>()
    seqs.forEach((s, si) =>
      s.forEach((col, i) => {
        if (col && !covered[si][i]) bump(c, `${col[0]}\t${col[1]}`)
      }),
    )
    const eff = (k: string) => {
      const n = c.get(k) ?? 0
      return n >= minSites ? n : 0
    }
    for (const [k] of c) {
      const [x, y] = k.split('\t')
      bump(r0, x, eff(k))
      bump(r1, y, eff(k))
    }
    const dir = (x: string, y: string, n: number, row: number) => {
      const same = x === y && x !== GAP ? beta : 0
      if (n + same > 0) return -Math.log((n + same) / (row + (x !== GAP ? beta : 0)))
      return (x !== GAP ? typo : 0) + (y !== GAP ? typo : 0)
    }
    return (col: Col) => {
      if (!col) return 0
      const [x, y] = col
      const n = eff(`${x}\t${y}`)
      return dir(x, y, n, r0.get(x) ?? 0) + dir(y, x, n, r1.get(y) ?? 0)
    }
  }
  /** 單位（或家族）的分母：出現過的成員中不同的來源字串、目標字串的出現次數之和 */
  const denominators = (c: Candidate, os: Occ[]): [number, number] => {
    const srcs = new Set<string>(), tgts = new Set<string>()
    for (const o of os) {
      const m = memberOf(o)
      srcs.add(occurrenceKey(m.src, c.position))
      tgts.add(occurrenceKey(m.tgt, c.position))
    }
    const sum = (k: 0 | 1, keys: Set<string>) => [...keys].reduce((s, x) => s + (occ[k].get(x) ?? 0), 0)
    return [Math.max(os.length, sum(0, srcs)), Math.max(os.length, sum(1, tgts))]
  }
  const costOf = (n: number, d: [number, number]): [number, number] => [-Math.log(n / d[0]), -Math.log(n / d[1])]

  const pool = [...cands.values()].filter((c) => c.occ.length >= minSites && supportOf(c.occ) >= minSupport)
  const units: CsrLearnedUnit[] = []
  const chosen: Array<{ c: Candidate; members: Map<string, { src: string; tgt: string }>; n: number; of: [number, number] }> = []
  while (chosen.length < maxUnits) {
    const colCost = unigram()
    let best: { c: Candidate; free: Occ[]; gain: number } | null = null
    for (const c of pool) {
      if (c.done) continue
      const free = c.occ.filter(isFree)
      if (free.length < minSites || supportOf(free) < minSupport) continue
      const [c0, c1] = costOf(free.length, denominators(c, free))
      let path = 0
      for (const [si, i, L] of free) for (let k = i; k < i + L; k++) path += colCost(seqs[si][k])
      const gain = path - free.length * (c0 + c1) - penalty
      if (gain > 0 && (!best || gain > best.gain)) best = { c, free, gain }
    }
    if (!best) break
    best.c.done = true
    // 解釋掉：出現處的欄（不重疊的）歸給這個單位
    const taken: Occ[] = []
    for (const o of best.free) {
      if (!isFree(o)) continue
      const [si, i, L] = o
      for (let k = i; k < i + L; k++) if (seqs[si][k]) covered[si][k] = 1
      taken.push(o)
    }
    const { c } = best
    const members = new Map<string, { src: string; tgt: string }>()
    const examples: Array<[string, string]> = []
    for (const o of taken) {
      const m = memberOf(o)
      members.set(`${m.src}|${m.tgt}`, { src: m.src, tgt: m.tgt })
      const forms = pairs[o[0]].forms
      if (examples.length < 4 && !examples.some(([a, b]) => a === forms[0] && b === forms[1])) examples.push(forms)
    }
    const of = denominators(c, taken)
    chosen.push({ c, members, n: taken.length, of })
    units.push({
      reflexes: { [dialects[0]]: c.src || GAP, [dialects[1]]: c.tgt || GAP },
      ...(c.position ? { position: c.position } : {}),
      members: [...members.values()].map((m) => ({ [dialects[0]]: m.src || GAP, [dialects[1]]: m.tgt || GAP })),
      sites: taken.length,
      support: supportOf(taken),
      gain: Math.round(best.gain * 100) / 100,
      cost: costOf(taken.length, of).map((x) => Math.round(x * 1000) / 1000) as [number, number],
      examples,
    })
  }

  // 剩下的欄：單一音段的對應組
  const rest = new Map<string, number>()
  seqs.forEach((s, si) =>
    s.forEach((col, i) => {
      if (col && !covered[si][i]) bump(rest, `${col[0]}\t${col[1]}`)
    }),
  )
  const patterns: CsrPattern[] = [...rest].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => {
    const [x, y] = k.split('\t')
    return { reflexes: { [dialects[0]]: x, [dialects[1]]: y }, sites: n }
  })
  const occurrences: Record<string, Record<string, number>> = { [dialects[0]]: {}, [dialects[1]]: {} }
  for (const { c, members, n, of } of chosen)
    for (const m of members.values()) {
      const reflexes = { [dialects[0]]: m.src || GAP, [dialects[1]]: m.tgt || GAP }
      const position = c.position ? { position: c.position } : {}
      if (c.family) patterns.push({ reflexes, sites: n, ...position, of: { [dialects[0]]: of[0], [dialects[1]]: of[1] } })
      else {
        patterns.push({ reflexes, sites: n, ...position })
        occurrences[dialects[0]][occurrenceKey(m.src, c.position)] = of[0]
        occurrences[dialects[1]][occurrenceKey(m.tgt, c.position)] = of[1]
      }
    }
  return { patterns, occurrences, units, ...(poolVowels ? { vowels: [...vowels].sort() } : {}) }
}
