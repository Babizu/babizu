/**
 * @file 基本（單字元）編輯成本模型。
 *
 * 方向約定：距離一律是「把查詢字串 X 轉成候選字串 Y」的成本。
 * - 刪除 delete：刪掉 X 的一個字元（查詢多打了字）
 * - 插入 insert：補上 Y 的一個字元（查詢少打了字）
 * - 替換 substitute：X 的字元換成 Y 的字元；相同字元成本為 0
 *
 * **詞邊界（空白）不能與字母互換**：邊界只能插入或刪除。邊界的成本很低（空白的插入、刪除是 0.1），
 * 如果字母可以換成邊界，任何字母都能以邊界的價錢消失（「b 換成空白」只要 0.1，等於便宜地刪掉 b）；
 * 所以「b 變成邊界」要刪除 b 再插入空白（1.0 ＋ 0.1）。
 * 邊界字元由距離函式設定（WeightedEditDistance 的 boundaries，withBoundaries）。
 */

/** 針對單一字元覆寫的成本 */
export interface CharCostOverride {
  /** 此字元參與替換（無論在 X 或 Y 側）時的成本；邊界字元與字母之間不能替換，不受這個值影響 */
  substitute?: number
  /** 刪除此字元的成本 */
  delete?: number
  /** 插入此字元的成本 */
  insert?: number
}

export interface CostOptions {
  /** 預設 1.2 */
  substitute?: number
  /** 預設 1.0 */
  delete?: number
  /** 預設 1.0 */
  insert?: number
  /** 以字元為鍵的覆寫表，例如空白 */
  overrides?: Readonly<Record<string, CharCostOverride>>
}

/** 需求文件指定的基本成本：替換 1.2、刪除 1.0、插入 1.0；空白的插入與刪除皆為 0.1（空白不能與字母互換）。 */
export const DEFAULT_COSTS: Readonly<Required<CostOptions>> = Object.freeze({
  substitute: 1.2,
  delete: 1.0,
  insert: 1.0,
  overrides: Object.freeze({
    ' ': Object.freeze({ delete: 0.1, insert: 0.1 }),
  }),
})

export class CostModel {
  /** 原始設定（withBoundaries 用） */
  readonly options: CostOptions
  /** 詞邊界字元：與非邊界字元之間不能替換（只能插入、刪除） */
  readonly boundaries: Set<string>
  readonly substituteCost: number
  readonly deleteCost: number
  readonly insertCost: number
  readonly overrides: Map<string, CharCostOverride>

  /** @param boundaries 詞邊界字元：與非邊界字元之間不能替換（只能插入、刪除） */
  constructor(options: CostOptions = {}, boundaries: Iterable<string> = []) {
    this.options = options
    this.boundaries = new Set(boundaries)
    const merged = { ...DEFAULT_COSTS, ...options }
    this.substituteCost = checkCost(merged.substitute, 'substitute')
    this.deleteCost = checkCost(merged.delete, 'delete')
    this.insertCost = checkCost(merged.insert, 'insert')
    this.overrides = new Map()
    for (const [ch, o] of Object.entries(merged.overrides ?? {})) {
      for (const key of ['substitute', 'delete', 'insert'] as const) {
        if (o[key] !== undefined) checkCost(o[key], `overrides[${JSON.stringify(ch)}].${key}`)
      }
      this.overrides.set(ch, { ...o })
    }
  }

  /** 同樣的成本，換一組詞邊界字元（距離函式建立時設定）。 */
  withBoundaries(boundaries: Iterable<string>): CostModel {
    return new CostModel(this.options, boundaries)
  }

  /**
   * 替換成本。邊界字元與非邊界字元之間不能替換（Infinity：只能刪除再插入）；
   * 其餘若任一側字元有 substitute 覆寫，取覆寫值中較小者。
   * @param a X 側字元
   * @param b Y 側字元
   */
  sub(a: string, b: string): number {
    if (a === b) return 0
    if (this.boundaries.has(a) !== this.boundaries.has(b)) return Infinity
    const oa = this.overrides.get(a)?.substitute
    const ob = this.overrides.get(b)?.substitute
    if (oa === undefined && ob === undefined) return this.substituteCost
    return Math.min(oa ?? Infinity, ob ?? Infinity)
  }

  /** @param a 被刪除的 X 側字元 */
  del(a: string): number {
    return this.overrides.get(a)?.delete ?? this.deleteCost
  }

  /** @param b 被插入的 Y 側字元 */
  ins(b: string): number {
    return this.overrides.get(b)?.insert ?? this.insertCost
  }

  /** 可序列化的設定，供視覺化頁面或除錯使用 */
  toJSON(): Required<CostOptions> {
    return {
      substitute: this.substituteCost,
      delete: this.deleteCost,
      insert: this.insertCost,
      overrides: Object.fromEntries(this.overrides),
    }
  }
}

/** 成本必須是非負有限數。這是詞圖搜尋能單調剪枝的前提。 */
function checkCost(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new RangeError(`成本 ${name} 必須是非負有限數，收到 ${String(v)}`)
  }
  return v
}
