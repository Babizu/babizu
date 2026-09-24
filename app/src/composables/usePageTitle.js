/**
 * @file 瀏覽器分頁標題：「頁面名稱｜網站名稱」，切換語系時一起更新。
 *
 * 頁面名稱預設取自路由的 `meta.titleKey`（介面字串的鍵）；
 * 頁面可以設定 `pageTitle` 蓋過它，例如詞條頁用詞形當標題，分享連結與書籤才認得出是哪一筆。
 * 換頁時路由會把 `pageTitle` 清掉（見 router.js）。
 */

import { ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { t } from '@/i18n.js'
import { siteTitle } from '@/lib/labels.js'

/** 目前頁面自訂的標題；null 表示用路由的預設名稱 */
export const pageTitle = ref(/** @type {string | null} */ (null))

/** 在 App.vue 呼叫一次，讓分頁標題跟著路由、自訂標題與語系更新 */
export function useDocumentTitle() {
  const route = useRoute()
  watchEffect(() => {
    const key = /** @type {string | null | undefined} */ (route.meta.titleKey)
    const page = pageTitle.value ?? (key ? t(key) : null)
    document.title = page ? `${page}｜${siteTitle()}` : siteTitle()
  })
}
