/**
 * @file 對應組檢索（實驗性）：以學到的語音對應組為中介的跨方言搜尋（docs/csr.md）。
 *
 * 1. 詞庫的每個詞（詞形, 方言）以設定檔的詞綴去詞綴，每個（詞, 詞幹）是一個單位；詞幹以學出的音類切成鍵，
 *    相鄰兩個鍵的二元組建倒排索引；
 * 2. 查詢也去詞綴；每個殘餘以二元組取共有最多的前 topM 個單位；
 * 3. 每個（殘餘, 單位）以成本表與前後文單位做加權 DP：查詢的方言未知，對每個假設的查詢方言取最好的
 *    （與詞條同一個方言時用「只有兩邊相同」的表）；方言未知的詞條，詞條的方言也一併假設；
 * 4. 分數 ＝ 距離 ＋ λ ×（兩邊剝掉的詞綴數），每個詞取最好的分析；依寬鬆程度的門檻篩選、排序。
 */

import { createTextTools } from '../text.ts'
import type { LanguageProfile } from '#bcdp'
import { createAffixStripper, type CsrAffix } from './affixes.ts'
import { buildContextTables, buildCostTables, contextMatches, createAligner, inventoryOf, soundClasses, type ContextTable, type ContextUnit, type CsrStep } from './costs.ts'
import { CSR_DEFAULT_LEVELS, CSR_DEFAULTS, type CsrLevel, type CsrModel, type CsrParams } from './model.ts'

/** 詞庫中的一個詞：搜尋鍵與方言（null：方言未知） */
export interface CsrEntry {
  key: string
  dialect: string | null
}

/** 寬鬆程度：exact 只要詞幹與查詢完全相同、沒有剝詞綴的；normal、loose 依門檻 */
export type CsrFuzziness = 'exact' | 'normal' | 'loose'

export interface CsrHit {
  /** CsrEntry 的編號 */
  entry: number
  score: number
  /** 假設的查詢方言 */
  queryDialect: string
  /** 詞條的方言（方言未知的詞條是假設的方言） */
  entryDialect: string
  queryStem: string
  queryAffixes: CsrAffix[]
  entryStem: string
  entryAffixes: CsrAffix[]
}

export class CorrespondenceSearch {
  readonly params: CsrParams
  readonly levels: { normal: CsrLevel; loose: CsrLevel }
  readonly dialects: string[]
  readonly entries: readonly CsrEntry[]
  /** 單位數、音類數、前後文單位數（所有方言對的方向合計）與建立耗時（ms） */
  readonly stats: { units: number; classes: number; contextUnits: number; buildMs: number }
  private readonly inventory: ReturnType<typeof inventoryOf>
  private readonly tables: Float64Array[]
  private readonly context: ContextTable[]
  private readonly aligner: ReturnType<typeof createAligner>
  private readonly stripper: ReturnType<typeof createAffixStripper>
  private readonly classOf: Int32Array
  private readonly units: Array<{ entry: number; b: number; stem: string; affixes: CsrAffix[]; side: { lattice: Int32Array[]; chars: string[] } }> = []
  private readonly postings = new Map<string, number[]>()
  private readonly counts: Int32Array

  /** 是否也假設查詢與詞條同一個方言（研究的評估只比不同方言時關掉） */
  private readonly sameDialect: boolean

  constructor({ model, profile, entries, sameDialect = true }: { model: CsrModel; profile: LanguageProfile; entries: readonly CsrEntry[]; sameDialect?: boolean }) {
    const started = now()
    this.params = { ...CSR_DEFAULTS, ...(model.params ?? {}) }
    this.levels = { normal: model.levels?.normal ?? CSR_DEFAULT_LEVELS.normal, loose: model.levels?.loose ?? CSR_DEFAULT_LEVELS.loose }
    this.dialects = model.dialects
    this.entries = entries
    this.sameDialect = sameDialect
    const text = createTextTools(profile)
    const chars = new Set<string>()
    for (const e of entries) for (const c of Array.from(e.key)) chars.add(c)
    this.inventory = inventoryOf([...model.segments.map((s) => text.searchKey(s) || s), ...chars])
    // 語音對應全部來自模型；語言設定檔的方言規則不參與（只用它的構詞規格去詞綴）
    this.tables = buildCostTables({ dialects: this.dialects, inventory: this.inventory, patterns: model.patterns, minSites: this.params.minSites, beta: this.params.beta })
    this.context = buildContextTables({
      dialects: this.dialects,
      segments: new Set(this.inventory.forms),
      patterns: model.patterns,
      occurrences: model.occurrences,
      minSites: this.params.minSites,
      normalize: (s) => text.searchKey(s) || s,
    })
    const N = this.dialects.length, F = this.inventory.F
    this.classOf = soundClasses(this.tables, N, F, this.params.mergeProbability)
    this.aligner = createAligner(this.inventory)
    this.stripper = createAffixStripper(profile, text.searchKey)
    const dIndex = new Map(this.dialects.map((d, k) => [d, k]))
    entries.forEach((e, entry) => {
      const b = e.dialect === null ? -1 : (dIndex.get(e.dialect) ?? -1)
      for (const a of this.stripper.analyses(e.key).values()) {
        const idx = this.units.length
        this.units.push({ entry, b, stem: a.stem, affixes: a.affixes, side: { lattice: this.inventory.tokenize(a.stem), chars: Array.from(a.stem) } })
        for (const g of this.bigrams(a.stem)) {
          let list = this.postings.get(g)
          if (!list) this.postings.set(g, (list = []))
          list.push(idx)
        }
      }
    })
    this.counts = new Int32Array(this.units.length)
    this.stats = {
      units: this.units.length,
      classes: new Set(Array.from(this.classOf).slice(1)).size,
      contextUnits: this.context.reduce((n, t) => n + t.size, 0),
      buildMs: Math.round(now() - started),
    }
  }

  /** 詞幹的鍵：最長匹配切段 → 音類，前後加邊界，取相鄰兩個的二元組 */
  private bigrams(stem: string): Set<string> {
    const keys = ['^', ...this.inventory.segment(stem).map((s) => {
      const k = this.inventory.id.get(s)
      return k === undefined ? `?${s}` : String(this.classOf[k])
    }), '$']
    const out = new Set<string>()
    for (let i = 0; i + 1 < keys.length; i++) out.add(`${keys[i]},${keys[i + 1]}`)
    return out
  }

  /** 共有二元組最多的前 topM 個單位（依計數分桶，不必整個排序） */
  private candidates(stem: string): number[] {
    const touched: number[] = []
    let max = 0
    for (const g of this.bigrams(stem))
      for (const k of this.postings.get(g) ?? []) {
        if (this.counts[k]++ === 0) touched.push(k)
        if (this.counts[k] > max) max = this.counts[k]
      }
    const buckets: number[][] = Array.from({ length: max + 1 }, () => [])
    for (const k of touched) buckets[this.counts[k]].push(k)
    for (const k of touched) this.counts[k] = 0
    const out: number[] = []
    for (let c = max; c > 0 && out.length < this.params.topM; c--) {
      const b = buckets[c].sort((x, y) => x - y)
      for (let i = 0; i < b.length && out.length < this.params.topM; i++) out.push(b[i])
    }
    return out
  }

  /** 這個寬鬆程度的分數上限（exact 沒有分數上限，另外篩） */
  maxScore(query: string, fuzziness: CsrFuzziness): number {
    if (fuzziness === 'exact') return Infinity
    const { a, b } = this.levels[fuzziness]
    return a + b * Array.from(query).length
  }

  /**
   * 搜尋。
   * @param query 已正規化的查詢（搜尋鍵，不含空白）
   * @param accept 只考慮這些詞（CsrEntry 的編號）
   * @returns 依分數排序（同分依詞形）
   */
  search(query: string, { fuzziness = 'normal', accept }: { fuzziness?: CsrFuzziness; accept?: (entry: number) => boolean } = {}): CsrHit[] {
    if (!query) return []
    const { lambda, typo } = this.params
    const N = this.dialects.length
    const max = this.maxScore(query, fuzziness)
    const best = new Map<number, CsrHit>()
    const memo = new Map<string, { d: number; a: number; b: number }>()
    for (const q of this.stripper.analyses(query).values()) {
      const kq = q.affixes.length
      if (fuzziness === 'exact' && kq > 0) continue
      const qs = { lattice: this.inventory.tokenize(q.stem), chars: Array.from(q.stem) }
      // 每對方言的前後文單位在查詢中的位置（每個詞幹只算一次）
      const qc: Array<ContextUnit[][] | null | undefined> = []
      const contextOf = (k: number) => (qc[k] === undefined ? (qc[k] = this.context[k].size ? contextMatches(qs.chars, this.context[k]) : null) : qc[k])
      // DP 算到這個上限就停（同一個詞幹的備忘都用同一個上限：詞條沒有剝詞綴時最寬）
      const bound = max - lambda * kq
      for (const ui of this.candidates(q.stem)) {
        const u = this.units[ui]
        if (accept && !accept(u.entry)) continue
        const extra = lambda * (kq + u.affixes.length)
        if (fuzziness === 'exact' ? u.affixes.length > 0 || u.stem !== q.stem : extra > max) continue
        const key = `${q.stem}\u0000${u.stem}\u0000${u.b}`
        let hit = memo.get(key)
        if (!hit) {
          hit = { d: Infinity, a: 0, b: Math.max(u.b, 0) }
          for (const b of u.b >= 0 ? [u.b] : this.dialects.map((_, k) => k))
            for (let a = 0; a < N; a++) {
              if (a === b && !this.sameDialect) continue
              const d = this.aligner.distance(qs, u.side, this.tables[a * N + b], typo, Math.min(bound, hit.d), contextOf(a * N + b))
              if (d < hit.d) hit = { d, a, b }
            }
          memo.set(key, hit)
        }
        const score = hit.d + extra
        if (score > max) continue
        const prev = best.get(u.entry)
        if (!prev || score < prev.score)
          best.set(u.entry, {
            entry: u.entry,
            score: Math.round(score * 1000) / 1000,
            queryDialect: this.dialects[hit.a],
            entryDialect: this.dialects[hit.b],
            queryStem: q.stem,
            queryAffixes: q.affixes,
            entryStem: u.stem,
            entryAffixes: u.affixes,
          })
      }
    }
    return [...best.values()].sort((x, y) => x.score - y.score || (this.entries[x.entry].key < this.entries[y.entry].key ? -1 : 1))
  }

  /**
   * 命中的對齊：每一步是哪一對音段、成本多少（說明用）。
   * 前後文單位另外附「拆開來看」：同一段只用單一音段的對應比對的各步（對照合在一起時便宜多少）
   */
  explain(hit: Pick<CsrHit, 'queryStem' | 'entryStem' | 'queryDialect' | 'entryDialect'>): CsrStep[] {
    const N = this.dialects.length
    const a = this.dialects.indexOf(hit.queryDialect), b = this.dialects.indexOf(hit.entryDialect)
    const cost = this.tables[a * N + b], typo = this.params.typo
    return this.aligner.align(hit.queryStem, hit.entryStem, cost, typo, this.context[a * N + b]).map((s) =>
      s.kind === 'context' ? { ...s, parts: this.aligner.align(s.source, s.target, cost, typo).filter((p) => p.kind !== 'match') } : s,
    )
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
