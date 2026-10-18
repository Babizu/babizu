/**
 * @file 工作台編輯方言規則：語言設定檔的規則可以寫成 `[來源, 目標, 權重]` 或物件（另有位置、是否雙向）。
 * 編輯時統一看成物件；寫回時沒有額外設定就用陣列的寫法（與手寫的設定檔一致）。
 */

import type { RulePosition, RuleTableRow } from '#bcdp'

export interface RuleRowView {
  source: string
  target: string
  weight: number
  /** 沒有時沿用整組的位置 */
  position?: RulePosition
  /** 沒有時是雙向 */
  bidirectional?: boolean
}

export function ruleRowView(row: RuleTableRow): RuleRowView {
  if (Array.isArray(row)) return { source: row[0], target: row[1], weight: row[2] }
  const view: RuleRowView = { source: row.source, target: row.target, weight: row.weight }
  if (row.position) view.position = row.position
  if (row.bidirectional === false) view.bidirectional = false
  return view
}

export function ruleRowFrom(view: RuleRowView): RuleTableRow {
  if (!view.position && view.bidirectional !== false) return [view.source, view.target, view.weight]
  return {
    source: view.source,
    target: view.target,
    weight: view.weight,
    ...(view.position ? { position: view.position } : {}),
    ...(view.bidirectional === false ? { bidirectional: false } : {}),
  }
}

/** 這一列有沒有問題（給畫面標紅）：兩邊都空白、權重不是非負的數 */
export function ruleRowProblem(view: RuleRowView): 'empty' | 'weight' | null {
  if (!view.source && !view.target) return 'empty'
  if (typeof view.weight !== 'number' || !Number.isFinite(view.weight) || view.weight < 0) return 'weight'
  return null
}
