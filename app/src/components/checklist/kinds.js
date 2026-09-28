/**
 * @file 檢查清單的類別名稱（依最接近的詞條猜的類別、完全相同的詞條的篩選）。
 * 每個類別帶一個符號：與搜尋結果的「≈」同一套寫法，不另加圖示。
 */

import { msg } from '@/i18n.js'

/** 例句中沒有詞條的詞：依最接近的詞條猜的類別（babizu/search 的 TokenKind） */
export const TOKEN_KINDS = [
  {
    value: 'variant',
    glyph: '≈',
    label: msg('像方言變體'),
    hint: msg('只靠方言對應規則就對得上辭典中的詞條，多半是同一個詞的另一種寫法。'),
  },
  {
    value: 'derivation',
    glyph: '+',
    label: msg('像加綴派生'),
    hint: msg('構詞分析找得到辭典中的詞根，多半是詞根條目底下沒有列出的加綴形式。'),
  },
  {
    value: 'near',
    glyph: '~',
    label: msg('有相近的詞條'),
    hint: msg('辭典中有拼寫相近的詞條，但不是單純的方言對應或加綴，需要人工判斷。'),
  },
  {
    value: 'none',
    glyph: '∅',
    label: msg('沒有相近的詞條'),
    hint: msg('辭典中找不到拼寫相近的詞條，可能需要新增條目。'),
  },
]

/** 完全相同的詞條、重複的例句：篩選 */
export const DUPLICATE_FILTERS = [
  { value: 'all', label: msg('全部') },
  { value: 'repeated', label: msg('疑似重複登錄'), hint: msg('同一個來源內，文字與釋義（例句是翻譯）都相同的記錄') },
  { value: 'sameSource', label: msg('同一來源內') },
  { value: 'crossSource', label: msg('跨來源') },
]
