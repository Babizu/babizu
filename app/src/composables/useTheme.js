/**
 * @file 深色／淺色模式。偏好存在 localStorage（'light'、'dark'，或 'auto' 跟隨系統）；未設定時跟隨系統。
 * index.html 在載入前就會套用，避免閃爍；兩邊的儲存鍵與值必須一致。
 */

import { useColorMode } from '@vueuse/core'
import { computed } from 'vue'
import site from 'virtual:babizu/site'

/** 儲存鍵以站台代號為前綴，同一個網域放多個辭典網站時才不會互相干擾（index.html 用同一個鍵） */
const { store, state } = useColorMode({ storageKey: `${site.id}:theme`, emitAuto: true })

/** 實際套用的是不是深色（跟隨系統時依系統設定） */
const isDark = computed(() => state.value === 'dark')

export function useTheme() {
  return {
    isDark,
    /** 使用者的選擇：light、dark、auto（跟隨系統） */
    mode: store,
    /** @param {'light' | 'dark' | 'auto'} value */
    setMode: (value) => {
      store.value = value
    },
  }
}
