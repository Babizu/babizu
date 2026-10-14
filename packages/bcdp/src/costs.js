/**
 * @file 基本（單字元）編輯成本模型。
 *
 * 方向約定：距離一律是「把查詢字串 X 轉成候選字串 Y」的成本。
 * - 刪除 delete：刪掉 X 的一個字元（查詢多打了字）
 * - 插入 insert：補上 Y 的一個字元（查詢少打了字）
 * - 替換 substitute：X 的字元換成 Y 的字元；相同字元成本為 0
 *
 * **詞邊界（空白）不能與字母互換**：邊界只能插入或刪除。否則邊界便宜的成本會讓任何字母以邊界的價錢消失：
 * 舊版空白的 substitute 覆寫是 0.1，查 pinahazaban 時 zaban 對上多詞詞條 da ran，b 換成空白只算 0.1
 * （再插入一個 r），等於「刪掉 b」只要 0.1（研究紀錄 U.25）。現在「b 變成邊界」要刪除 b 再插入空白（1.0 ＋ 0.1）。
 * 邊界字元由距離函式設定（WeightedEditDistance 的 boundaries，withBoundaries）。
 */

/**
 * @typedef {object} CharCostOverride 針對單一字元覆寫的成本
 * @property {number} [substitute] 此字元參與替換（無論在 X 或 Y 側）時的成本；邊界字元與字母之間不能替換，不受這個值影響
 * @property {number} [delete] 刪除此字元的成本
 * @property {number} [insert] 插入此字元的成本
 */

/**
 * @typedef {object} CostOptions
 * @property {number} [substitute=1.5]
 * @property {number} [delete=1.0]
 * @property {number} [insert=0.8]
 * @property {Record<string, CharCostOverride>} [overrides] 以字元為鍵的覆寫表，例如空白
 */

/** 需求文件指定的基本成本：替換 1.5、刪除 1.0、插入 0.8；空白的插入與刪除皆為 0.1（空白不能與字母互換）。 */
export const DEFAULT_COSTS = Object.freeze({
  substitute: 1.5,
  delete: 1.0,
  insert: 0.8,
  overrides: Object.freeze({
    ' ': Object.freeze({ delete: 0.1, insert: 0.1 }),
  }),
})

export class CostModel {
  /**
   * @param {CostOptions} [options]
   * @param {Iterable<string>} [boundaries] 詞邊界字元：與非邊界字元之間不能替換（只能插入、刪除）
   */
  constructor(options = {}, boundaries = []) {
    /** 原始設定（withBoundaries 用） */
    this.options = options
    /** @type {Set<string>} */
    this.boundaries = new Set(boundaries)
    const merged = { ...DEFAULT_COSTS, ...options }
    this.substituteCost = checkCost(merged.substitute, 'substitute')
    this.deleteCost = checkCost(merged.delete, 'delete')
    this.insertCost = checkCost(merged.insert, 'insert')
    /** @type {Map<string, CharCostOverride>} */
    this.overrides = new Map()
    for (const [ch, o] of Object.entries(merged.overrides ?? {})) {
      for (const key of ['substitute', 'delete', 'insert']) {
        if (o[key] !== undefined) checkCost(o[key], `overrides[${JSON.stringify(ch)}].${key}`)
      }
      this.overrides.set(ch, { ...o })
    }
  }

  /**
   * 同樣的成本，換一組詞邊界字元（距離函式建立時設定）。
   * @param {Iterable<string>} boundaries
   */
  withBoundaries(boundaries) {
    return new CostModel(this.options, boundaries)
  }

  /**
   * 替換成本。邊界字元與非邊界字元之間不能替換（Infinity：只能刪除再插入）；
   * 其餘若任一側字元有 substitute 覆寫，取覆寫值中較小者。
   * @param {string} a X 側字元
   * @param {string} b Y 側字元
   */
  sub(a, b) {
    if (a === b) return 0
    if (this.boundaries.has(a) !== this.boundaries.has(b)) return Infinity
    const oa = this.overrides.get(a)?.substitute
    const ob = this.overrides.get(b)?.substitute
    if (oa === undefined && ob === undefined) return this.substituteCost
    return Math.min(oa ?? Infinity, ob ?? Infinity)
  }

  /** @param {string} a 被刪除的 X 側字元 */
  del(a) {
    return this.overrides.get(a)?.delete ?? this.deleteCost
  }

  /** @param {string} b 被插入的 Y 側字元 */
  ins(b) {
    return this.overrides.get(b)?.insert ?? this.insertCost
  }

  /** 可序列化的設定，供視覺化頁面或除錯使用 */
  toJSON() {
    return {
      substitute: this.substituteCost,
      delete: this.deleteCost,
      insert: this.insertCost,
      overrides: Object.fromEntries(this.overrides),
    }
  }
}

/**
 * 成本必須是非負有限數。這是詞圖搜尋能單調剪枝的前提。
 * @param {unknown} v
 * @param {string} name
 */
function checkCost(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new RangeError(`成本 ${name} 必須是非負有限數，收到 ${String(v)}`)
  }
  return v
}
