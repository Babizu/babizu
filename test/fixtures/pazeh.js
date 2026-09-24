/**
 * @file 測試用的真實語言設定：巴宰語與噶哈巫語。
 *
 * 框架本身與語言無關，但測試需要一套真實、夠複雜的規則（多字元對應、詞尾規則、國際音標對應）。
 * 這裡的物件全部由 JSON 設定檔 `pazeh-kaxabu.profile.json` 建立——也就是說，
 * 每一個用到它們的測試，同時也在驗證「由設定檔建立」的路徑行為正確。
 *
 * 設定檔的正本在 pazeh-kaxabu 網站 repo 的 language/ 目錄；這裡是測試用的副本。
 */

import { readFileSync } from 'node:fs'
import { createMetricFromProfile, createRulesFromProfile } from '../../src/fuzzy/index.js'

/** @type {import('../../src/fuzzy/profile.js').LanguageProfile} */
export const PAZEH_PROFILE = JSON.parse(readFileSync(new URL('./pazeh-kaxabu.profile.json', import.meta.url), 'utf8'))

export const PAZEH_KAXABU_RULES = PAZEH_PROFILE.rules ?? []

/** @param {Partial<import('../../src/fuzzy/distance.js').MetricOptions>} [overrides] */
export const createPazehKaxabuMetric = (overrides) => createMetricFromProfile(PAZEH_PROFILE, overrides)

export const createPazehKaxabuRules = () => createRulesFromProfile(PAZEH_PROFILE)
