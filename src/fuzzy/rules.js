/**
 * @file 語音對應規則（多字元對多字元的加權替換）。
 *
 * 一條規則 `(source → target, weight)` 表示：查詢字串 X 中的子字串 `source`
 * 可以用 `weight` 的成本對應到候選字串 Y 中的子字串 `target`。
 * 空字串代表脫落或增生，例如 `('r', '')` 是 r 脫落。
 *
 * 使用者的查詢方向無法預測（可能拿 A 方言查 B 方言，也可能反過來），
 * 因此預設自動補上反向規則，確保距離對語音規則而言是對稱的。
 */

/** @typedef {'any' | 'initial' | 'final'} RulePosition 規則適用位置：任何位置／詞首／詞尾 */

/**
 * @typedef {object} RuleOptions
 * @property {RulePosition} [position='any']
 * @property {boolean} [bidirectional=true] 是否自動補上反向規則
 * @property {string} [category] 分類（例如「閃音」），可整類開關
 * @property {string} [label] 顯示用說明
 */

/**
 * @typedef {object} Rule 一條「有方向」的規則（反向規則是另一個 Rule 物件）
 * @property {string} source X 側子字串
 * @property {string} target Y 側子字串
 * @property {number} weight
 * @property {RulePosition} position
 * @property {string | null} category
 * @property {string | null} label
 * @property {boolean} reversed 是否為自動產生的反向規則
 * @property {number} origin 原始規則的序號（同一條規則的正反向共用）
 */

/**
 * @typedef {[string, string, number] | ({source: string, target: string, weight: number} & RuleOptions)} RuleTableRow
 */

/**
 * @typedef {object} RuleGroup 以分類整理的規則表（語言設定檔的 rules 即為此格式）
 * @property {string} category 分類代號（也是預設的顯示名稱；可以開關整類規則）
 * @property {Record<string, string>} [label] 各介面語系的分類名稱，例如 `{ en: 'Word-final' }`；只影響顯示
 * @property {RulePosition} [position] 整組預設位置
 * @property {string} [description]
 * @property {RuleTableRow[]} rules
 */

const POSITIONS = new Set(['any', 'initial', 'final'])

export class RuleSet {
  constructor() {
    /** @type {Array<{source: string, target: string, weight: number, position: RulePosition, bidirectional: boolean, category: string|null, label: string|null}>} */
    this._defs = []
    /** @type {Set<string>} 已停用的分類 */
    this._disabled = new Set()
  }

  /**
   * 新增一條規則。
   * @param {string} source
   * @param {string} target
   * @param {number} weight
   * @param {RuleOptions} [options]
   * @returns {this}
   *
   * @example
   * rules.add('l', 'n', 0.1, { position: 'final', category: '詞尾' })
   */
  add(source, target, weight, options = {}) {
    const { position = 'any', bidirectional = true, category = null, label = null } = options
    if (typeof source !== 'string' || typeof target !== 'string') {
      throw new TypeError('規則的 source 與 target 必須是字串')
    }
    if (source === '' && target === '') {
      throw new RangeError('規則的 source 與 target 不可同時為空字串')
    }
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`規則 ${JSON.stringify([source, target])} 的權重必須是非負有限數`)
    }
    if (!POSITIONS.has(position)) {
      throw new RangeError(`未知的規則位置：${position}（可用：any、initial、final）`)
    }
    this._defs.push({ source, target, weight, position, bidirectional, category, label })
    return this
  }

  /**
   * 從規則表批次新增。接受兩種列格式：`[source, target, weight]` 或物件。
   * @param {RuleTableRow[] | RuleGroup[]} table
   * @param {RuleOptions} [defaults] 套用在每一列的預設選項
   * @returns {this}
   */
  addTable(table, defaults = {}) {
    for (const item of table) {
      if (item && !Array.isArray(item) && Array.isArray(/** @type {RuleGroup} */ (item).rules)) {
        const group = /** @type {RuleGroup} */ (item)
        this.addTable(group.rules, {
          ...defaults,
          category: group.category,
          ...(group.position ? { position: group.position } : {}),
        })
        continue
      }
      if (Array.isArray(item)) {
        const [source, target, weight] = item
        this.add(source, target, weight, defaults)
      } else {
        const row = /** @type {{source: string, target: string, weight: number} & RuleOptions} */ (item)
        const { source, target, weight, ...opts } = row
        this.add(source, target, weight, { ...defaults, ...opts })
      }
    }
    return this
  }

  /**
   * 由規則表建立 RuleSet。
   * @param {RuleTableRow[] | RuleGroup[]} table
   * @param {RuleOptions} [defaults]
   */
  static fromTable(table, defaults = {}) {
    return new RuleSet().addTable(table, defaults)
  }

  /** 停用整個分類 @param {string} category */
  disable(category) {
    this._disabled.add(category)
    return this
  }

  /** 啟用整個分類 @param {string} category */
  enable(category) {
    this._disabled.delete(category)
    return this
  }

  /** 目前所有分類名稱（依首次出現順序） */
  categories() {
    return [...new Set(this._defs.map((d) => d.category).filter((c) => c !== null))]
  }

  /**
   * 展開成有方向的規則清單：套用分類開關、補反向規則、以 (位置, source, target) 去重並保留最小權重。
   * 每一條 source 與 target 都會先經過 `normalize`。
   *
   * @param {(s: string) => string} [normalize] 與距離計算相同的正規化函式
   * @returns {Rule[]}
   */
  expand(normalize = (s) => s) {
    /** @type {Map<string, Rule>} */
    const byKey = new Map()
    this._defs.forEach((def, origin) => {
      if (def.category !== null && this._disabled.has(def.category)) return
      const source = normalize(def.source)
      const target = normalize(def.target)
      if (source === target) return // 正規化後相同的規則沒有意義
      const variants = [{ source, target, reversed: false }]
      if (def.bidirectional) variants.push({ source: target, target: source, reversed: true })
      for (const v of variants) {
        const key = `${def.position}\u0000${v.source}\u0000${v.target}`
        const prev = byKey.get(key)
        if (!prev || def.weight < prev.weight) {
          byKey.set(key, {
            source: v.source,
            target: v.target,
            weight: def.weight,
            position: def.position,
            category: def.category,
            label: def.label,
            reversed: v.reversed,
            origin,
          })
        }
      }
    })
    return [...byKey.values()]
  }

  /** 規則定義（未展開），可直接 JSON 序列化並用 `fromTable` 還原 */
  toJSON() {
    return this._defs.map((d) => ({ ...d, enabled: d.category === null || !this._disabled.has(d.category) }))
  }

  /** 複製一份（含分類開關狀態） */
  clone() {
    const copy = new RuleSet()
    copy._defs = this._defs.map((d) => ({ ...d }))
    copy._disabled = new Set(this._disabled)
    return copy
  }
}
