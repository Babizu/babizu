/**
 * @file 演算法實驗室的狀態：可編輯的規則表與成本，並由此建立距離函式。
 *
 * 規則表以站台語言設定檔的規則為起點，使用者可以：
 * - 整類開關、調整單條權重與適用位置
 * - 新增自訂規則
 * - 調整基本成本（替換、刪除、插入、空白）
 *
 * 距離函式以搜尋引擎同一個 createSearchMetric 建立：正規化（含刪除體例符號）、詞邊界都與搜尋相同，
 * 規則也經過同一個 RuleSet.fromTable。沒有修改時，實驗室算出的距離與搜尋完全一致。
 */

import { DEFAULT_COSTS, RuleSet } from '@babizu/fuzzy/index.js'
import { createSearchMetric } from '@babizu/search/text.js'
import site from 'virtual:babizu/site'
import { computed, reactive } from 'vue'
import { t } from '@/i18n.js'

/** @type {import('@babizu/fuzzy/profile.js').LanguageProfile} */
const PROFILE = /** @type {any} */ (site.profile)

/**
 * @typedef {object} EditableRule
 * @property {string} source
 * @property {string} target
 * @property {number} weight
 * @property {'any' | 'initial' | 'final'} position
 * @property {boolean} bidirectional 雙向（設定檔的規則預設雙向）
 */

/**
 * @typedef {object} EditableGroup
 * @property {string} category
 * @property {string} description
 * @property {boolean} enabled
 * @property {EditableRule[]} rules
 */

function defaultGroups() {
  return (PROFILE.rules ?? []).map((g) => ({
    category: g.category,
    description: g.description ?? '',
    enabled: true,
    rules: g.rules.map((row) => {
      if (Array.isArray(row)) {
        const [source, target, weight] = /** @type {[string, string, number]} */ (row)
        return { source, target, weight, position: g.position ?? 'any', bidirectional: true }
      }
      const r = /** @type {any} */ (row)
      return {
        source: r.source,
        target: r.target,
        weight: r.weight,
        position: r.position ?? g.position ?? 'any',
        bidirectional: r.bidirectional ?? true,
      }
    }),
  }))
}

/**
 * 可編輯的基本成本，預設值與搜尋相同（設定檔沒寫的取框架預設，替換 1.5、刪除 1.0、插入 0.8、空白 0.1）。
 * 空白的三種操作在介面上合成一個滑桿。
 */
function defaultCosts() {
  const costs = /** @type {import('@babizu/fuzzy/costs.js').CostOptions} */ (PROFILE.costs ?? {})
  const space = (costs.overrides ?? DEFAULT_COSTS.overrides)[' ']
  return {
    substitute: costs.substitute ?? DEFAULT_COSTS.substitute,
    delete: costs.delete ?? DEFAULT_COSTS.delete,
    insert: costs.insert ?? DEFAULT_COSTS.insert,
    space: space?.substitute ?? costs.substitute ?? DEFAULT_COSTS.substitute,
  }
}

export function createLabState() {
  const state = reactive({
    /** @type {EditableGroup[]} */
    groups: defaultGroups(),
    /** @type {EditableRule[]} */
    custom: [],
    costs: defaultCosts(),
  })

  /** 依目前設定建立距離函式（設定變動時自動重建） */
  const metric = computed(() => {
    const table = [
      ...state.groups.filter((g) => g.enabled).map((g) => ({ category: g.category, rules: g.rules.filter(valid) })),
      { category: t('lab.customCategory'), rules: state.custom.filter(valid) },
    ]
    const rules = RuleSet.fromTable(/** @type {any} */ (table.map((g) => ({ ...g, rules: g.rules.map(row) }))))
    return createSearchMetric(PROFILE, { rules, costs: editedCosts(state.costs) })
  })

  const activeRuleCount = computed(
    () => state.groups.filter((g) => g.enabled).reduce((n, g) => n + g.rules.length, 0) + state.custom.length,
  )

  function reset() {
    state.groups = defaultGroups()
    state.custom = []
    state.costs = defaultCosts()
  }

  return { state, metric, activeRuleCount, reset }
}

/**
 * 規則列是否合法；不合法的列（例如兩側皆空、權重非數字）直接略過，讓編輯中的半成品不會讓頁面出錯。
 * @param {EditableRule} r
 */
function valid(r) {
  const weight = Number(r.weight)
  return Number.isFinite(weight) && weight >= 0 && Boolean(r.source || r.target)
}

/** 可編輯的規則列 → 設定檔的規則物件列 @param {EditableRule} r */
function row(r) {
  return { source: r.source, target: r.target, weight: Number(r.weight), position: r.position, bidirectional: r.bidirectional ?? true }
}

/**
 * 使用者改過成本時，以編輯後的值取代設定檔的成本；沒改時回傳 undefined，直接用設定檔（與搜尋完全相同，
 * 包括空白以外的字元覆寫，以及空白三種操作各自的成本）。
 * @param {ReturnType<typeof defaultCosts>} costs
 */
function editedCosts(costs) {
  const base = defaultCosts()
  if (costs.substitute === base.substitute && costs.delete === base.delete && costs.insert === base.insert && costs.space === base.space) {
    return undefined
  }
  const profileCosts = /** @type {import('@babizu/fuzzy/costs.js').CostOptions} */ (PROFILE.costs ?? {})
  const overrides = { ...(profileCosts.overrides ?? DEFAULT_COSTS.overrides) }
  if (costs.space !== base.space) overrides[' '] = { substitute: costs.space, delete: costs.space, insert: costs.space }
  return { substitute: costs.substitute, delete: costs.delete, insert: costs.insert, overrides }
}
