/**
 * @file Word（.docx）文件讀取與逐詞對譯（interlinear gloss）抽取。
 *
 * .docx 是 zip 壓縮的 XML。這裡只讀 word/document.xml 的正文，依原順序輸出
 * 「段落」與「表格」兩種元素，不處理樣式。
 */

import { readFile } from 'node:fs/promises'
import { DOMParser } from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'

/**
 * @typedef {{type: 'paragraph', text: string} | {type: 'table', rows: string[][]}} BodyElement
 */

/**
 * 讀取 .docx 正文。
 * @param {string} path
 * @returns {Promise<BodyElement[]>}
 */
export async function readDocxBody(path) {
  const files = unzipSync(new Uint8Array(await readFile(path)), {
    filter: (file) => file.name === 'word/document.xml',
  })
  const xml = files['word/document.xml']
  if (!xml) throw new Error(`${path} 不是有效的 .docx（找不到 word/document.xml）`)
  return parseDocumentXml(strFromU8(xml))
}

/**
 * 解析 document.xml 字串（拆出來方便測試）。
 * @param {string} xml
 * @returns {BodyElement[]}
 */
export function parseDocumentXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const body = doc.getElementsByTagName('w:body')[0]
  if (!body) return []

  /** @type {BodyElement[]} */
  const elements = []
  for (let node = body.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue
    const el = /** @type {Element} */ (/** @type {unknown} */ (node))
    if (el.nodeName === 'w:p') {
      elements.push({ type: 'paragraph', text: textOf(el) })
    } else if (el.nodeName === 'w:tbl') {
      const rows = childElements(el, 'w:tr').map((tr) => childElements(tr, 'w:tc').map((tc) => textOf(tc)))
      elements.push({ type: 'table', rows })
    }
  }
  return elements
}

/**
 * 元素底下所有 w:t 的文字（段落之間不加分隔）。
 * @param {Element} el
 */
function textOf(el) {
  const texts = el.getElementsByTagName('w:t')
  let out = ''
  for (let k = 0; k < texts.length; k++) out += texts[k].textContent ?? ''
  return out.trim()
}

/**
 * @param {Element} el
 * @param {string} name
 * @returns {Element[]}
 */
function childElements(el, name) {
  const out = []
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && node.nodeName === name) out.push(/** @type {Element} */ (/** @type {unknown} */ (node)))
  }
  return out
}

/**
 * @typedef {object} InterlinearBlock 一句話的逐詞對譯
 * @property {string | null} video 所屬影片檔名（例如 IMG_2659.MOV）
 * @property {string | null} audioFile 「音檔檔名：」段落指出的音檔
 * @property {string | null} text 族語句子
 * @property {Array<{form: string, gloss: string}>} pairs 逐詞（詞素）對譯
 * @property {string | null} translation 自由翻譯（去掉「」）
 */

const VIDEO_HEADING = /^[\w.-]+\.(mov|mp4|m4v|avi|mts)$/iu
const AUDIO_LINE = /^音檔檔名[:：]\s*(.+)$/u
const TRANSLATION_LINE = /^「(.*)」$/u

/**
 * 從正文抽出逐詞對譯區塊。預期的版面（潘德興語料 docx）：
 *
 * ```
 * IMG_2659.MOV                      ← 影片標題
 * 音檔檔名：IMG_2659_1_tamako.mp3    ← （可選）音檔
 * tamako                            ← 族語句子
 * [表格] 詞形列／對譯列（長句會有多組）
 * 「斗笠」                          ← 自由翻譯，結束這一句
 * ```
 *
 * @param {BodyElement[]} elements
 * @returns {InterlinearBlock[]}
 */
export function extractInterlinearBlocks(elements) {
  /** @type {InterlinearBlock[]} */
  const blocks = []
  /** @type {string | null} */
  let video = null
  /** @type {InterlinearBlock | null} */
  let current = null

  const open = () => {
    current = { video, audioFile: null, text: null, pairs: [], translation: null }
    blocks.push(current)
    return current
  }
  /** 目前區塊是否已經結束（有翻譯）或已經有表格，不能再放句子 */
  const isClosed = (/** @type {InterlinearBlock | null} */ b) => !b || b.translation !== null || b.pairs.length > 0

  for (const el of elements) {
    if (el.type === 'table') {
      const block = current ?? open()
      for (let r = 0; r + 1 < el.rows.length; r += 2) {
        const forms = el.rows[r]
        const glosses = el.rows[r + 1]
        forms.forEach((form, c) => {
          const gloss = glosses[c] ?? ''
          if (form || gloss) block.pairs.push({ form, gloss })
        })
      }
      continue
    }

    const text = el.text
    if (!text) continue
    if (VIDEO_HEADING.test(text)) {
      video = text
      current = null
      continue
    }
    const audio = AUDIO_LINE.exec(text)
    if (audio) {
      open().audioFile = audio[1].trim()
      continue
    }
    const translation = TRANSLATION_LINE.exec(text)
    if (translation && current && current.translation === null) {
      current.translation = translation[1].trim()
      continue
    }
    // 一般段落：族語句子
    if (current && current.text === null && !isClosed(current)) {
      current.text = text
    } else {
      open().text = text
    }
  }
  return blocks
}
