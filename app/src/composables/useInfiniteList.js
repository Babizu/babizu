/**
 * @file 捲動載入的清單：捲到清單尾端（哨兵元素進入視窗附近）就載入下一頁。
 *
 * - 換條件（reset）時，還在路上的舊請求回來也不會接進新清單（請求序號）。
 * - 哨兵之外，畫面上另有「載入更多」按鈕：鍵盤、螢幕報讀器使用者，或 IntersectionObserver 不能用的環境都能繼續。
 * - 載入失敗時停止自動載入，顯示錯誤與重試，不會一直重打。
 */

import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

/**
 * @template T, M
 * @param {(offset: number) => Promise<{items: T[], hasMore: boolean, meta?: M}>} fetchPage
 * @param {{margin?: number}} [options] margin：哨兵離視窗底部多少像素以內就開始載下一頁
 */
export function useInfiniteList(fetchPage, { margin = 800 } = {}) {
  /** @type {import('vue').ShallowRef<T[]>} */
  const items = shallowRef([])
  /** @type {import('vue').ShallowRef<M | null>} 最後一頁附帶的資訊（總數、進度…） */
  const meta = shallowRef(null)
  const loading = ref(false)
  const hasMore = ref(true)
  const error = ref('')
  /** @type {import('vue').Ref<HTMLElement | null>} 放在清單尾端的哨兵元素 */
  const sentinel = ref(null)

  let seq = 0
  let busy = false

  async function loadMore() {
    if (busy || !hasMore.value || error.value) return
    busy = true
    const mine = seq
    loading.value = true
    try {
      const page = await fetchPage(items.value.length)
      if (mine !== seq) return
      items.value = [...items.value, ...page.items]
      meta.value = page.meta ?? null
      hasMore.value = page.hasMore
    } catch (e) {
      if (mine === seq) error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (mine === seq) {
        loading.value = false
        busy = false
        // 一頁不夠填滿畫面時，哨兵仍在視窗附近，IntersectionObserver 不會再通知：等畫面更新後量一次實際位置，
        // 還在附近就接著載（不能用上一次通知的結果，那時新的一頁還沒畫出來）
        await nextTick()
        if (mine === seq && nearViewport() && hasMore.value && !error.value) loadMore()
      }
    }
  }

  /** 換條件：清空，從第一頁重新載入 */
  function reset() {
    seq++
    busy = false
    items.value = []
    meta.value = null
    hasMore.value = true
    error.value = ''
    loading.value = false
    return loadMore()
  }

  /** 失敗後重試（從目前的位置接著載） */
  function retry() {
    error.value = ''
    return loadMore()
  }

  /** 哨兵是否在視窗內或下方 margin 像素以內 */
  function nearViewport() {
    const el = sentinel.value
    if (!el || typeof window === 'undefined') return false
    const rect = el.getBoundingClientRect()
    return rect.top < window.innerHeight + margin && rect.bottom > -margin
  }

  /** @type {IntersectionObserver | null} */
  let observer = null
  if (typeof IntersectionObserver !== 'undefined') {
    // 通知可能是清單還空著時的狀態（非同步送達時新的一頁已經畫出來了）：以當下的實際位置為準
    observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && nearViewport() && loadMore(), {
      rootMargin: `${margin}px 0px`,
    })
  }
  watch(sentinel, (el, old) => {
    if (old) observer?.unobserve(old)
    if (el) observer?.observe(el)
  })
  onBeforeUnmount(() => observer?.disconnect())

  return { items, meta, loading, hasMore, error, sentinel, loadMore, reset, retry }
}
