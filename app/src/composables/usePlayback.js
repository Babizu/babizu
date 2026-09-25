/**
 * @file 逐步播放（演算法實驗室共用，見 docs/lab-design.md 第 4、7 節）。
 *
 * 狀態只有一個步驟序號 index：−1 表示「還沒開始」，total − 1 是最後一步（完整結果）。
 * 畫面由序號推出（src/fuzzy/steps.js 的 *StateAt），所以上一步、拖曳進度、網址的 step 都只是改序號。
 */

import { useIntervalFn } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

/** 1× 速度時每一步的毫秒數 */
export const BASE_STEP_MS = 600
/** 可選的速度 */
export const SPEEDS = Object.freeze([0.5, 1, 2, 4])

/**
 * @param {import('vue').Ref<number> | import('vue').ComputedRef<number>} total 步數（輸入改變時會變）
 * @param {{initial?: number}} [options] 初始序號（例如網址的 step）；省略時停在最後一步
 */
export function usePlayback(total, { initial } = {}) {
  const index = ref(initial ?? total.value - 1)
  const speed = ref(1)

  const clamp = (/** @type {number} */ n) => Math.max(-1, Math.min(total.value - 1, Math.floor(n)))
  const atStart = computed(() => index.value <= -1)
  const atEnd = computed(() => index.value >= total.value - 1)

  const timer = useIntervalFn(
    () => {
      if (atEnd.value) {
        timer.pause()
        return
      }
      index.value++
    },
    computed(() => BASE_STEP_MS / speed.value),
    { immediate: false },
  )
  const playing = timer.isActive

  function play() {
    // 在結尾按播放：從頭開始
    if (atEnd.value) index.value = -1
    timer.resume()
  }
  const pause = () => timer.pause()
  const toggle = () => (playing.value ? pause() : play())
  /** @param {number} n */
  function seek(n) {
    pause()
    index.value = clamp(n)
  }
  const next = () => seek(index.value + 1)
  const prev = () => seek(index.value - 1)
  const first = () => seek(-1)
  const last = () => seek(total.value - 1)
  const restart = () => {
    seek(-1)
    play()
  }

  // 步數改變（輸入改變）時停止並顯示完整結果
  watch(total, (n) => {
    pause()
    index.value = n - 1
  })

  /**
   * 鍵盤操作：← → 上一步、下一步；Space 播放／暫停；R 重來；Home、End 第一步、最後一步。
   * 焦點在輸入框、下拉選單或其他會用到這些按鍵的控制項時不處理。
   * @param {KeyboardEvent} event
   */
  function onKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const target = /** @type {HTMLElement | null} */ (event.target)
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="grid"], [role="tablist"]')) return
    const actions = /** @type {Record<string, () => void>} */ ({
      ArrowLeft: prev,
      ArrowRight: next,
      ' ': toggle,
      r: restart,
      R: restart,
      Home: first,
      End: last,
    })
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  return { index, speed, playing, atStart, atEnd, play, pause, toggle, seek, next, prev, first, last, restart, onKeydown }
}
