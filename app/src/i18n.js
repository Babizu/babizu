/**
 * @file 介面語系。
 *
 * 字串來自框架的 locales/*.json，站台可以覆寫任一字串或新增語系（站台目錄的 locales/）。
 * 某個語系缺的字串會回退到預設語系，所以可以先開放一個語系、再慢慢翻譯
 * （`babizu locales` 會列出缺哪些）。
 *
 * ```vue
 * <script setup>
 * const { t, tr } = useI18n()
 * </script>
 * <template>
 *   <p>{{ t('search.noResultsFor', { query }) }}</p>          <!-- 介面字串 -->
 *   <h1>{{ tr(site.title) }}</h1>                              <!-- 站台設定中依語系提供的文字 -->
 * </template>
 * ```
 *
 * 不用 vue-i18n：需要的只是「查字串＋代入參數＋回退」，自己寫不到一百行，也少一個相依套件。
 */

import { computed, ref, watch } from 'vue'
import site from 'virtual:babizu/site'

const STORAGE_KEY = `${site.id}:locale`

/** 瀏覽器偏好語言中，第一個本站有提供的語系 */
function browserLocale() {
  const wanted = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? [navigator.language])]
  for (const lang of wanted) {
    if (!lang) continue
    const exact = site.locales.find((l) => l.toLowerCase() === lang.toLowerCase())
    if (exact) return exact
    const primary = lang.split('-')[0].toLowerCase()
    const partial = site.locales.find((l) => l.split('-')[0].toLowerCase() === primary)
    if (partial) return partial
  }
  return null
}

function initialLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && site.locales.includes(saved)) return saved
  } catch {
    // 無法使用 localStorage（隱私模式等）時照常運作
  }
  return browserLocale() ?? site.defaultLocale
}

/** 目前的介面語系 */
export const locale = ref(initialLocale())

watch(
  locale,
  (value) => {
    if (typeof document !== 'undefined') document.documentElement.lang = value
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // 同上
    }
  },
  { immediate: true },
)

/**
 * 代入 `{name}` 形式的參數。
 * @param {string} message
 * @param {Record<string, unknown>} [params]
 */
function interpolate(message, params) {
  if (!params) return message
  return message.replace(/\{(\w+)\}/gu, (whole, name) => (name in params ? String(params[name]) : whole))
}

/**
 * 查介面字串。找不到時依序回退到預設語系、鍵名本身（方便發現漏翻的字串）。
 * @param {string} key 例如 `search.placeholder`
 * @param {Record<string, unknown>} [params]
 */
export function t(key, params) {
  const message = site.messages[locale.value]?.[key] ?? site.messages[site.defaultLocale]?.[key] ?? key
  return interpolate(message, params)
}

/**
 * 取出站台設定中依語系提供的文字（已在建置時攤開成每個語系都有值）。
 * @param {Record<string, string> | null | undefined} localized
 */
export function tr(localized) {
  if (!localized) return ''
  return localized[locale.value] ?? localized[site.defaultLocale] ?? ''
}

/** 數字加千分位（依介面語系） @param {number} n */
export function formatCount(n) {
  try {
    return n.toLocaleString(locale.value)
  } catch {
    return n.toLocaleString()
  }
}

/** @param {string} value */
export function setLocale(value) {
  if (site.locales.includes(value)) locale.value = value
}

export function useI18n() {
  return {
    locale: computed(() => locale.value),
    locales: site.locales,
    localeNames: site.localeNames,
    t,
    tr,
    formatCount,
    setLocale,
  }
}
