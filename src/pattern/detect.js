/**
 * @file 自動判斷一個查詢要不要以句型搜尋。網站的搜尋框只有一個：一般的查詢照舊，
 * 用到句型專用寫法的查詢才改用句型搜尋。Web Worker 與介面共用這個函式，兩邊的判斷一定相同。
 *
 * 只看「一般搜尋不會這樣寫」的符號；量詞 `? * +`、連字號、`=`、括號單獨出現時都不算，
 * 因為讀者常照辭典或語法書的寫法輸入（`pa-kita`、`sikis-`、`ha=ka`、`kita?`、`yaku (ka) mupuza lia.`）。
 * 判斷錯了可以用網址的 m=plain 或 m=pattern 強制（見 docs/pattern-query.md 第 5 節）。
 */

/**
 * 每一條都是「只有句型搜尋才會這樣寫」的寫法，附上理由（顯示在除錯資訊與測試中）。
 * @type {Array<{reason: string, test: RegExp}>}
 */
const TRIGGERS = [
  // 單獨的 _：任一個詞
  { reason: '_', test: /(?:^|[\s(|&!])_(?=$|[\s)|&?*+{/])/u },
  // … 或 ...：詞裡的任意部分（拼寫樣式、構詞樣式）
  { reason: '…', test: /…|\.\.\./u },
  // 引號：拼寫完全相同
  { reason: 'quote', test: /["“”]/u },
  // 擇一、同一句都要有
  { reason: '|', test: /\|/u },
  { reason: '&', test: /&/u },
  // 句首、句尾
  { reason: '^', test: /(?:^|[\s(|&])\^/u },
  { reason: '$', test: /\$(?=$|[\s)|&])/u },
  // 前置的 !（後面緊接一個詞或括號）；句末的驚嘆號（kita!）不算
  { reason: '!', test: /(?:^|[\s(|&])!(?=[\p{L}"“(@_!^])/u },
  // 次數量詞（緊接在詞或右括號後面）
  { reason: '{n}', test: /[^\s{]\{\s*\d+\s*(?:,\s*\d*\s*)?\}/u },
  // 右括號後接量詞：(yaku ka)?
  { reason: ')?', test: /\)[?*+{]/u },
  // @詞：詞族
  { reason: '@', test: /(?:^|[\s(|&!/])@\p{L}/u },
]

/**
 * @param {string} query
 * @returns {{pattern: boolean, reason: string | null}} pattern：是否以句型搜尋；reason：觸發的寫法
 */
export function looksLikePattern(query) {
  const q = String(query ?? '').trim()
  // 含漢字的查詢是中文釋義搜尋，不是句型
  if (!q || /\p{Script=Han}/u.test(q)) return { pattern: false, reason: null }
  for (const t of TRIGGERS) if (t.test.test(q)) return { pattern: true, reason: t.reason }
  return { pattern: false, reason: null }
}

/**
 * 依網址的模式參數與查詢決定要不要以句型搜尋。
 * @param {string} query
 * @param {string | null | undefined} mode 'plain' 強制一般搜尋、'pattern' 強制句型搜尋，其他（含未指定）自動判斷
 */
export function isPatternQuery(query, mode) {
  if (mode === 'plain') return false
  if (mode === 'pattern') return Boolean(String(query ?? '').trim())
  return looksLikePattern(query).pattern
}
