/**
 * @file 主選單項目（頂端列與底部分頁列共用）。`labelKey` 是介面字串的鍵。
 */

import { BookOpenIcon, InfoIcon, SearchIcon } from '@lucide/vue'
import { msg } from '@/i18n.js'

/**
 * 主選單。演算法實驗室不放在這裡（屬於進階說明），
 * 入口在「關於」頁與搜尋結果的「查看計算過程」連結。
 */
export const NAV_ITEMS = [
  { name: 'search', labelKey: msg('搜尋'), to: { name: 'search' }, icon: SearchIcon },
  { name: 'sources', labelKey: msg('資料來源'), to: { name: 'sources' }, icon: BookOpenIcon },
  { name: 'about', labelKey: msg('關於'), to: { name: 'about' }, icon: InfoIcon },
]
