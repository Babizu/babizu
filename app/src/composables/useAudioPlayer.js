/**
 * @file 全站唯一的音訊播放器。
 *
 * 所有播放按鈕共用同一個 <audio> 元素：
 * - 同一時間只會播放一段（按下另一個播放鈕會停止前一段）
 * - 支援片段播放（start／end 秒數），供「整支錄音中的某一句」使用
 * - 以 key 辨識「目前在播哪一個按鈕」，按鈕可據此顯示播放中狀態
 */

import { readonly, ref } from 'vue'
import { dataUrl } from '@/services/data.js'

/** @type {HTMLAudioElement | null} */
let audio = null
/** @type {number | null} 片段結束秒數 */
let segmentEnd = null

/** 目前播放中的 key（通常是記錄 id） */
const currentKey = ref(/** @type {string | null} */ (null))
/** @type {import('vue').Ref<'idle' | 'loading' | 'playing' | 'error'>} */
const state = ref('idle')

function ensureAudio() {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'none'
  audio.addEventListener('playing', () => (state.value = 'playing'))
  audio.addEventListener('waiting', () => (state.value = 'loading'))
  audio.addEventListener('ended', stop)
  audio.addEventListener('error', () => {
    if (currentKey.value) state.value = 'error'
  })
  audio.addEventListener('timeupdate', () => {
    if (segmentEnd !== null && audio && audio.currentTime >= segmentEnd) stop()
  })
  return audio
}

/**
 * 播放。若同一個 key 正在播放則改為停止（切換行為）。
 * @param {string} key
 * @param {string} src 相對資料根目錄的路徑
 * @param {{start?: number | null, end?: number | null}} [segment]
 */
async function toggle(key, src, segment = {}) {
  const el = ensureAudio()
  if (currentKey.value === key && state.value !== 'error') {
    stop()
    return
  }
  el.pause()
  currentKey.value = key
  state.value = 'loading'
  segmentEnd = segment.end ?? null
  const url = dataUrl(src)
  if (el.src !== new URL(url, window.location.href).href) el.src = url
  el.currentTime = segment.start ?? 0
  try {
    await el.play()
  } catch (e) {
    // 使用者快速切換時 play() 會被新的載入中斷，這不是錯誤
    if (e instanceof DOMException && e.name === 'AbortError') return
    state.value = 'error'
  }
}

function stop() {
  audio?.pause()
  currentKey.value = null
  state.value = 'idle'
  segmentEnd = null
}

export function useAudioPlayer() {
  return { currentKey: readonly(currentKey), state: readonly(state), toggle, stop }
}
