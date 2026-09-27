/**
 * @file 介面語系。
 *
 * 介面字串直接寫在程式裡，中文原文就是鍵（src/site/messages.js）：中文介面直接顯示，
 * 其他語系到框架的 locales/<語系>.json 查譯文；站台可以覆寫任一字串或新增語系（站台目錄的 locales/）。
 * 查不到的字串回退到預設語系、再回退到中文原文，所以可以先開放一個語系、再慢慢翻譯
 * （`babizu locales` 會列出缺哪些）。
 *
 * ```vue
 * <script setup>
 * const { t, tr } = useI18n()
 * </script>
 * <template>
 *   <p>{{ t('「{query}」沒有結果', { query }) }}</p>   <!-- 介面字串，{query} 代入參數 -->
 *   <p>{{ t('詞條', null, '角色') }}</p>               <!-- 同一句中文要有不同譯文時加語境 -->
 *   <h1>{{ tr(site.title) }}</h1>                      <!-- 站台設定中依語系提供的文字 -->
 * </template>
 * ```
 *
 * 不用 vue-i18n：需要的只是「查字串＋代入參數＋回退」，自己寫不到一百行，也少一個相依套件。
 */

import { msg, sourceText } from '@babizu/site/messages.js'
import { computed, ref, watch } from 'vue'
import site from 'virtual:babizu/site'

export { msg }

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
 * 介面字串。中文原文就是鍵：依序查目前語系、預設語系的譯文（或站台的覆寫），都沒有就顯示中文原文。
 * @param {string} text 中文原文（或 msg() 產生的鍵）
 * @param {Record<string, unknown> | null} [params] 代入 `{name}` 的參數
 * @param {string} [context] 語境：同一句中文要有不同譯文時才需要
 */
export function t(text, params, context) {
  const key = msg(text, context)
  const message = site.messages[locale.value]?.[key] ?? site.messages[site.defaultLocale]?.[key] ?? sourceText(key)
  return interpolate(message, params ?? undefined)
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
