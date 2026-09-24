/**
 * @file 深色／淺色模式。偏好存在 localStorage；未設定時跟隨系統。
 * index.html 在載入前就會套用，避免閃爍；兩邊的儲存鍵必須一致。
 */

import { useDark, useToggle } from '@vueuse/core'
import site from 'virtual:babizu/site'

/** 儲存鍵以站台代號為前綴，同一個網域放多個辭典網站時才不會互相干擾（index.html 用同一個鍵） */
const isDark = useDark({ storageKey: `${site.id}:theme`, valueDark: 'dark', valueLight: 'light' })
const toggle = useToggle(isDark)

export function useTheme() {
  return { isDark, toggle }
}
