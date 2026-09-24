/**
 * @file 介面上的代碼顯示名稱與格式化工具。
 *
 * 代碼（單位、角色、校對狀態…）的名稱依介面語系而定，所以都寫成函式、每次呼叫時查字串，
 * 在模板中使用時切換語系會即時更新。語言變體與書寫系統的名稱來自站台設定。
 */

import site from 'virtual:babizu/site'
import { QUALITY_STATUSES } from '@babizu/schema/constants.js'
import { locale, t, tr } from '@/i18n.js'

export { QUALITY_STATUSES }
export { formatCount } from '@/i18n.js'

/** 站台設定（瀏覽器端的部分） */
export { site }

/** 單位名稱 @param {string} code */
export const unitLabel = (code) => t(`unit.${code}`)

/** 群組角色名稱 @param {string} code */
export const roleLabel = (code) => t(`role.${code}`)

/** 來源類型名稱 @param {string} code */
export const sourceTypeLabel = (code) => t(`sourceType.${code}`)

/** 校對狀態名稱 @param {string} code */
export const statusLabel = (code) => t(`status.${code}`)

/** 詞在記錄中出現的身分（見 babizu/search 的 MatchKind） @param {string} kind */
export const matchKindLabel = (kind) => t(`matchKind.${kind}`)

/** 編輯操作的名稱 @param {string} op */
export const opLabel = (op) => t(`op.${op}`)

/**
 * 語言變體（方言）名稱。站台設定沒有的代碼原樣顯示。
 * @param {string} code
 */
export function dialectLabel(code) {
  const variety = site.varieties.find((v) => v.code === code)
  return variety ? tr(variety.label) : code
}

/**
 * 書寫系統名稱：先查站台設定，再查框架字串（`writingSystem.<code>`），都沒有就顯示代碼。
 * @param {string} code
 */
export function writingSystemLabel(code) {
  const own = site.writingSystems[code]
  if (own) return tr(own)
  const key = `writingSystem.${code}`
  const label = t(key)
  return label === key ? code : label
}

/**
 * 語言變體，依「上層在前、下層緊接其後」排列（例如 巴宰 → 巴宰（愛蘭）→ 噶哈巫），
 * 從屬的變體相鄰才看得出關係。
 */
export function orderedVarieties() {
  /** @type {typeof site.varieties} */
  const out = []
  const visit = (/** @type {string | null} */ parent) => {
    for (const v of site.varieties.filter((x) => x.parent === parent)) {
      out.push(v)
      visit(v.code)
    }
  }
  visit(null)
  return out
}

/**
 * 距離數字的顯示格式：最多兩位小數，去掉多餘的 0。
 * @param {number} value
 */
export function formatDistance(value) {
  if (!Number.isFinite(value)) return '∞'
  return String(Math.round(value * 100) / 100)
}

/**
 * 對齊步驟的簡短說明，例如「l→n」、「r→∅」、「∅→h」。
 * @param {{source: string, target: string}} step
 */
export function formatStep(step) {
  return `${step.source || '∅'}→${step.target || '∅'}`
}

/**
 * 秒數 → mm:ss.cc
 * @param {number} seconds
 */
export function formatTimecode(seconds) {
  const cs = Math.round(seconds * 100)
  const m = Math.floor(cs / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/**
 * 記錄頁的路由位置。
 * @param {string} id 記錄 id（source:localId）
 */
export function recordRoute(id) {
  const k = id.indexOf(':')
  return { name: 'record', params: { source: id.slice(0, k), localId: id.slice(k + 1) } }
}

/**
 * 來源的分片單位名稱（「頁」「章」「場次」…）。來源資料裡寫的是資料本身的語言，
 * 所以預設語系直接用它，其他語系改用依瀏覽模式的通用名稱（`browse.shard.<mode>`）。
 * @param {{browse?: {mode: string, shardLabel: string}} | null | undefined} source
 */
export function shardUnitLabel(source) {
  if (!source?.browse) return ''
  if (locale.value === site.defaultLocale) return source.browse.shardLabel
  return t(`browse.shard.${source.browse.mode}`)
}

/** 網站名稱（依目前語系） */
export const siteTitle = () => tr(site.title)

/**
 * 語音規則分類的顯示名稱。分類名稱來自語言設定檔；規則群組可以另外提供
 * `label: { 'zh-TW': …, en: … }` 讓分類名稱也能翻譯，沒有就顯示原本的 category。
 * @param {string | null | undefined} category
 */
export function categoryLabel(category) {
  if (!category) return ''
  const group = /** @type {any[]} */ (site.profile?.rules ?? []).find((g) => g.category === category)
  return group?.label ? tr(group.label) || category : category
}

/** 語言設定檔的基本成本與最低的規則權重（說明「為什麼算相近」時用） */
export const COSTS = (() => {
  const costs = /** @type {any} */ (site.profile?.costs ?? {})
  const weights = /** @type {any[]} */ (site.profile?.rules ?? []).flatMap((g) => g.rules.map((r) => (Array.isArray(r) ? r[2] : r.weight)))
  return {
    substitute: costs.substitute ?? 1,
    delete: costs.delete ?? 1,
    insert: costs.insert ?? 1,
    rule: weights.length ? Math.min(...weights) : null,
  }
})()
