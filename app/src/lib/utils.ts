/**
 * @file shadcn-vue 共用工具。
 */

import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ClassValue } from 'clsx'

/**
 * 合併 class：clsx 處理條件式，tailwind-merge 解決衝突（後者覆蓋前者）。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
