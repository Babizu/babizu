/**
 * @file 只讓最新的一次請求寫入狀態。
 *
 * 切換頁面或條件時，舊的請求可能比新的晚回來；回來時要先確認「這還是目前的請求」再寫入狀態，
 * 否則畫面會被舊的結果蓋掉。
 *
 * ```ts
 * const latest = useLatestRequest()
 * watch(query, async (q) => {
 *   const isCurrent = latest.start()
 *   const result = await client.search(q)
 *   if (isCurrent()) response.value = result
 * })
 * ```
 */

export interface LatestRequest {
  /** 開始一次新的請求（之前的全部作廢），回傳「這一次還是不是最新的請求」 */
  start(): () => boolean
}

export function useLatestRequest(): LatestRequest {
  let latest = 0
  return {
    start() {
      const mine = ++latest
      return () => mine === latest
    },
  }
}
