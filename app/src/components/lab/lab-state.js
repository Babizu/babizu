/**
 * @file 演算法實驗室的狀態：可編輯的規則表與成本，並由此建立距離函式。
 *
 * 規則表以站台語言設定檔的規則為起點，使用者可以：
 * - 整類開關、調整單條權重與適用位置
 * - 新增自訂規則
 * - 調整基本成本（替換、刪除、插入、空白）
 */

import { createNormalizer, normalizerOptionsFromProfile, RuleSet, WeightedEditDistance } from '@babizu/fuzzy/index.js'
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
        return { source, target, weight, position: g.position ?? 'any' }
      }
      const r = /** @type {any} */ (row)
      return { source: r.source, target: r.target, weight: r.weight, position: r.position ?? g.position ?? 'any' }
    }),
  }))
}

function defaultCosts() {
  const costs = /** @type {any} */ (PROFILE.costs ?? {})
  const substitute = costs.substitute ?? 1
  return {
    substitute,
    delete: costs.delete ?? 1,
    insert: costs.insert ?? 1,
    space: costs.overrides?.[' ']?.substitute ?? substitute,
  }
}

const normalize = createNormalizer(normalizerOptionsFromProfile(PROFILE))

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
    const rules = new RuleSet()
    for (const group of state.groups) {
      if (!group.enabled) continue
      for (const r of group.rules) addSafely(rules, r, group.category)
    }
    for (const r of state.custom) addSafely(rules, r, t('lab.customCategory'))
    const space = state.costs.space
    return new WeightedEditDistance({
      costs: {
        substitute: state.costs.substitute,
        delete: state.costs.delete,
        insert: state.costs.insert,
        overrides: { ' ': { substitute: space, delete: space, insert: space } },
      },
      rules,
      normalize,
    })
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
 * 加入規則；不合法的列（例如兩側皆空、權重非數字）直接略過，讓編輯中的半成品不會讓頁面出錯。
 * @param {RuleSet} rules
 * @param {EditableRule} r
 * @param {string} category
 */
function addSafely(rules, r, category) {
  const weight = Number(r.weight)
  if (!Number.isFinite(weight) || weight < 0) return
  if (!r.source && !r.target) return
  rules.add(r.source, r.target, weight, { position: r.position, category })
}
