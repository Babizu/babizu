/**
 * @file shadcn-vue 共用工具。
 */

import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合併 class：clsx 處理條件式，tailwind-merge 解決衝突（後者覆蓋前者）。
 * @param {...import('clsx').ClassValue} inputs
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
