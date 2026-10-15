/**
 * @file 辭典標註的構詞關係（確定拆解、確定派生、確定同根）：由詞條家族（docs.parent）與 `<` 標註算出，
 * 不是演算法推定的（那些是自動拆解、自動派生、自動同根，見 term-matcher.ts）。
 *
 * 一般搜尋的詞條與例句、句型搜尋的 `@詞` 都用這裡；三者都只從寫法與查詢相同的詞條展開。
 */

import type { FuzzyIndex } from '#bcdp'
import { decodePosting, type SearchDocs } from './format.ts'
import { KIND_RANK } from './scoring.ts'
import type { TextTools } from './text.ts'
import type { DictionaryKind, TermMatch } from './types.ts'

/** 辭典標註的一個構詞關係 */
export interface DictionaryRelation {
  /** 記錄編號 */
  doc: number
  kind: DictionaryKind
  /** 層數：上層、下層各算一層，同根是往上的層數加往下的層數 */
  depth: number
  /** 同根時是共同的上層（寫法） */
  via?: string
}

/** 辭典構詞關係中的記錄換成寫法（搜尋鍵）與 posting：例句與句型搜尋用 */
export interface DictionaryToken {
  term: string
  kind: DictionaryKind
  depth: number
  via?: string
  payloads: unknown[]
}

export class DictionaryRelations {
  private readonly docs: SearchDocs
  private readonly index: FuzzyIndex
  private readonly text: TextTools
  private readonly childrenOf: (k: number) => readonly number[]
  /** 詞 → 關係（同一個詞在一次搜尋中常查好幾次） */
  private readonly cache = new Map<string, DictionaryRelation[]>()
  /** 構詞規格中的詞綴寫法（isAffixEntry） */
  private affixForms: Set<string> | null = null

  /** @param childrenOf 記錄 → 下層記錄（family.ts 的 childrenLookup） */
  constructor(docs: SearchDocs, index: FuzzyIndex, text: TextTools, childrenOf: (k: number) => readonly number[]) {
    this.docs = docs
    this.index = index
    this.text = text
    this.childrenOf = childrenOf
  }

  /**
   * 以詞 t 為詞形的記錄（「自己」）在詞條家族（docs.parent）中的
   * - 下層（root，確定派生）：條目下的詞形、標明 < t 的另立條目，以及標明由 t 衍生、但接不上家族的記錄（詞根 posting）；
   * - 上層（parent，確定拆解）：自己所屬的條目、自己標明 < 的詞；
   * - 同一個上層的其他詞（sibling，確定同根）：上層的所有下層，扣掉自己這一支。上層是詞綴的條目（<in>、mina-：
   *   辭典把帶這個詞綴的詞列為例子）時不算：那是同一個詞綴，不是同一個詞根（isAffixEntry）。
   * 只收詞與詞綴，不收片語與例句。
   * 查 usa：mukusa（另立條目「< usa」、usa 條下的詞形）是下層；查 mukawas：kawas- 是上層，kawas- 條下的其他詞是同根。
   *
   * @returns 每筆記錄取最淺的一種（同樣深時依 KIND_RANK）
   */
  of(t: TermMatch): DictionaryRelation[] {
    const cached = this.cache.get(t.term)
    if (cached) return cached
    const docs = this.docs
    const isWord = (k: number) => {
      const unit = docs.units[docs.unit[k]]
      return unit === 'word' || unit === 'affix'
    }
    /** 以 t 為詞形的記錄 */
    const self = new Set<number>()
    /** 標明由 t 衍生的記錄（詞根 posting） */
    const marked: number[] = []
    for (const code of t.payloads as number[]) {
      const { doc: k, kind } = decodePosting(code)
      if (kind === 'root') marked.push(k)
      else if (kind !== 'token') self.add(k)
    }
    /** 由 starts 往下走（廣度優先），每筆記錄的最淺層數 */
    const below = (starts: Array<[number, number]>) => {
      const depth = new Map<number, number>()
      const queue = [...starts].sort((a, b) => a[1] - b[1])
      while (queue.length) {
        const [k, d] = queue.shift() as [number, number]
        if (depth.has(k)) continue
        depth.set(k, d)
        for (const c of this.childrenOf(k)) queue.push([c, d + 1])
      }
      return depth
    }
    const down = below([...[...self].map((k): [number, number] => [k, 0]), ...marked.map((k): [number, number] => [k, 1])])
    /** 上層與層數 */
    const up = new Map<number, number>()
    for (const k of self) {
      for (let p = docs.parent[k], d = 1; p !== -1 && !up.has(p); p = docs.parent[p], d++) up.set(p, d)
    }
    const out = new Map<number, DictionaryRelation>()
    const put = (k: number, kind: DictionaryKind, depth: number, via?: string) => {
      if (self.has(k) || !isWord(k)) return
      const prev = out.get(k)
      if (!prev || depth < prev.depth || (depth === prev.depth && KIND_RANK[kind] < KIND_RANK[prev.kind])) out.set(k, { doc: k, kind, depth, ...(via ? { via } : {}) })
    }
    for (const [k, d] of down) if (d > 0) put(k, 'root', d)
    for (const [k, d] of up) put(k, 'parent', d)
    for (const [a, u] of up) {
      if (this.isAffixEntry(a)) continue
      for (const [k, d] of below([[a, 0]])) {
        if (d > 0 && !down.has(k) && !up.has(k)) put(k, 'sibling', u + d, docs.text[a])
      }
    }
    const list = [...out.values()]
    this.cache.set(t.term, list)
    return list
  }

  /** 關係中的記錄換成它們的寫法（搜尋鍵）與 posting；同一個寫法取最淺的一種，片語與 t 本身不收。 */
  tokens(t: TermMatch): DictionaryToken[] {
    const out = new Map<string, DictionaryToken>()
    for (const r of this.of(t)) {
      const term = this.text.searchKey(this.docs.text[r.doc])
      if (!term || term === t.term || term.includes(' ')) continue
      const prev = out.get(term)
      if (prev && (prev.depth < r.depth || (prev.depth === r.depth && KIND_RANK[prev.kind] <= KIND_RANK[r.kind]))) continue
      const payloads = this.index.lookup(term)
      if (payloads) out.set(term, { term, kind: r.kind, depth: r.depth, ...(r.via ? { via: r.via } : {}), payloads })
    }
    return [...out.values()]
  }

  /**
   * 記錄是不是詞綴的條目：詞形（搜尋鍵）是語言設定檔構詞規格中的前綴、後綴、中綴或環綴的一側。
   * 詞根的條目（kita-、kawas-）也常寫成帶連字號，要靠規格區分；沒有構詞規格時一律當成詞根。
   */
  private isAffixEntry(k: number): boolean {
    const spec = this.text.morphology?.spec
    if (!spec) return false
    if (!this.affixForms) {
      this.affixForms = new Set([
        ...spec.prefixes.map((a) => a.form),
        ...spec.suffixes.map((a) => a.form),
        ...spec.infixes.map((a) => a.form),
        ...spec.circumfixes.flatMap((c) => [c.left, c.suffix].filter(Boolean)),
      ])
    }
    return this.affixForms.has(this.text.searchKey(this.docs.text[k]))
  }
}
