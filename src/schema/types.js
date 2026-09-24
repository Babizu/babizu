/**
 * @file 標準語料的 JSDoc 型別定義。
 *
 * 權威定義是 schema/*.schema.json；這裡是給編輯器提示用的對應型別。
 * 在其他檔案中以 `import('babizu/schema/types').CorpusRecord` 引用。
 */

/** @typedef {string} Dialect 語言變體（方言）代碼，允許的值由站台設定的 varieties 決定 */
/** @typedef {'affix' | 'word' | 'phrase' | 'sentence'} Unit */
/** @typedef {'head' | 'form' | 'example' | 'segment' | 'item'} GroupRole */
/** @typedef {'unreviewed' | 'reviewed' | 'verified'} QualityStatus 三級校對狀態 */

/**
 * @typedef {object} Sense 一個義項
 * @property {string | null} zh 中文
 * @property {string | null} en 英文
 * @property {string | null} nan 臺語
 * @property {string | null} [note]
 */

/**
 * @typedef {object} AltText 其他書寫系統的寫法
 * @property {string} system 書寫系統代碼（顯示名稱由站台設定的 writingSystems 或語系檔 `writingSystem.<code>` 提供）
 * @property {string} text
 */

/**
 * @typedef {object} Derivation 衍生來源
 * @property {'<' | '>' | '+'} relation
 * @property {string} text
 * @property {'A' | 'M' | null} [via] A 同化、M 換位
 * @property {string | null} [attribution]
 */

/**
 * @typedef {object} Morphology 構詞資訊
 * @property {'free' | 'bound-initial' | 'bound-final' | 'circumfix' | 'infix' | null} formType
 * @property {string | null} segmentation 分詞形式，例如 ma-des
 * @property {string | null} gloss 詞素對譯，例如 狀態-久
 * @property {string | null} [grammaticalNote] 語法標記
 * @property {Derivation[]} derivedFrom
 */

/**
 * @typedef {object} Variant 變體
 * @property {'=' | '~'} relation `=` 等同（方言讀音）、`~` 或
 * @property {string} text
 * @property {string | null} [attribution]
 * @property {Dialect[]} [dialects]
 * @property {string | null} [dialectRaw]
 */

/**
 * @typedef {object} RelatedLink 指向其他記錄的連結
 * @property {'see-also' | 'same-as' | 'derived-from' | 'variant-of'} type
 * @property {string} target 目標記錄 id
 * @property {string | null} [label]
 */

/**
 * @typedef {object} GroupRef 記錄在群組中的位置
 * @property {string} id 群組 id
 * @property {GroupRole} role
 * @property {string | null} parent 原書排在哪一筆底下（記錄 id）
 * @property {number | null} seq 在群組內的順序
 */

/**
 * @typedef {object} Timecode
 * @property {number} start 秒
 * @property {number} end 秒
 */

/**
 * @typedef {object} Citation 出處（溯源資訊）
 * @property {string} label 給人看的完整出處說明
 * @property {number | null} page
 * @property {number[]} pages
 * @property {number | null} row
 * @property {string | null} code
 * @property {string | null} file
 * @property {Timecode | null} timecode
 * @property {string | null} scan 掃描圖路徑（相對網站資料根目錄）
 */

/**
 * @typedef {object} Media 媒體（錄音、影片）
 * @property {'audio' | 'video'} type
 * @property {string | null} src
 * @property {number | null} start
 * @property {number | null} end
 * @property {boolean} available
 * @property {string | null} [label]
 */

/**
 * @typedef {object} CorpusRecord 標準語料記錄
 * @property {string} id
 * @property {string} source
 * @property {string} localId
 * @property {Unit} unit
 * @property {string} text
 * @property {AltText[]} altTexts
 * @property {Dialect[]} dialects
 * @property {string | null} dialectRaw
 * @property {Sense[]} senses
 * @property {string | null} pos
 * @property {{code: string, label: string | null} | null} domain
 * @property {Morphology | null} morphology
 * @property {Array<{form: string, gloss: string}>} interlinear
 * @property {Variant[]} variants
 * @property {RelatedLink[]} related
 * @property {GroupRef | null} group
 * @property {Citation} citation
 * @property {Media[]} media
 * @property {string | null} attribution
 * @property {string | null} speaker
 * @property {{status: QualityStatus, flags: string[]}} quality
 * @property {string[]} notes
 */

/**
 * @typedef {object} CorpusGroup 記錄群組
 * @property {string} id
 * @property {string} source
 * @property {'entry' | 'recording' | 'category' | 'list'} type
 * @property {string} title
 * @property {string | null} subtitle
 * @property {Citation | null} citation
 * @property {Media[]} media
 */

/**
 * @typedef {object} CorpusSource 資料來源
 * @property {string} id
 * @property {string} title
 * @property {string} shortTitle
 * @property {'dictionary' | 'wordlist' | 'corpus'} type
 * @property {string | null} description
 * @property {string[]} authors
 * @property {string | null} year
 * @property {string | null} publisher
 * @property {string | null} citation
 * @property {string | null} url
 * @property {string | null} license
 * @property {Dialect[]} defaultDialects
 * @property {string | null} orthography
 * @property {{mode: 'page' | 'category' | 'recording' | 'list', shardLabel: string}} browse
 * @property {string[]} notes
 * @property {Record<string, number>} [stats]
 */

/**
 * @typedef {object} CorpusShard 資料分片
 * @property {string} source
 * @property {string} shard
 * @property {string} label
 * @property {CorpusGroup[]} groups
 * @property {CorpusRecord[]} records
 */

export {}
