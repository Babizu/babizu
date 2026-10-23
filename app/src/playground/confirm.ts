/**
 * @file 工作台的確認視窗（取代 window.confirm）：askConfirm() 開啟，使用者按確定或取消之後 resolve。
 * 視窗本身是 components/studio/ConfirmDialog.vue，掛在工作台頁面上；一次只有一個。
 */

import { shallowRef } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  /** 確定按鈕的文字 */
  confirm: string
  /** 會刪掉資料的動作：確定按鈕用警示色 */
  destructive?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

/** 目前開著的確認視窗 */
export const pendingConfirm = shallowRef<Pending | null>(null)

/** 開確認視窗；按確定是 true，取消、按 Esc 或點外面是 false */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  pendingConfirm.value?.resolve(false)
  return new Promise((resolve) => {
    pendingConfirm.value = { ...options, resolve }
  })
}

/** 關閉確認視窗並回答 */
export function answerConfirm(ok: boolean): void {
  const pending = pendingConfirm.value
  pendingConfirm.value = null
  pending?.resolve(ok)
}
