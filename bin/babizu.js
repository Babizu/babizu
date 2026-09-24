#!/usr/bin/env node
/**
 * @file babizu 指令列工具。
 *
 *   babizu dev [站台目錄]       開發伺服器
 *   babizu build [站台目錄]     建置網站到 <站台>/dist
 *   babizu preview [站台目錄]   預覽建置結果（http://localhost:4173/）
 *   babizu check [站台目錄]     檢查設定、語言設定檔與資料集
 *   babizu locales [站台目錄]   列出各語系缺少的介面字串
 *
 * 站台目錄預設為目前目錄。
 */

import { resolve } from 'node:path'

const HELP = `用法：babizu <指令> [站台目錄] [選項]

指令：
  dev       開發伺服器（--port <埠號>）
  build     建置網站到 <站台>/dist
  preview   預覽建置結果（--port <埠號>，預設 4173）
  check     檢查站台設定、語言設定檔與資料集
  locales   列出各語系缺少的介面字串

站台目錄預設為目前目錄。說明文件：https://github.com/Babizu/babizu`

const [command, ...rest] = process.argv.slice(2)
const flags = new Map()
const positional = []
for (let k = 0; k < rest.length; k++) {
  if (rest[k].startsWith('--')) flags.set(rest[k].slice(2), rest[k + 1]?.startsWith('--') ? true : (rest[++k] ?? true))
  else positional.push(rest[k])
}
const siteDir = resolve(positional[0] ?? '.')
const port = flags.has('port') ? Number(flags.get('port')) : undefined

try {
  const site = await import('../src/site/index.js')
  switch (command) {
    case 'dev':
      await site.devSite(siteDir, { port })
      break
    case 'build':
      await site.buildSite(siteDir)
      break
    case 'preview':
      await site.previewSite(siteDir, { port })
      break
    case 'check':
      process.exitCode = (await site.checkSite(siteDir)) ? 0 : 1
      break
    case 'locales': {
      const config = await site.loadSiteConfig(siteDir)
      const missing = site.missingMessages(config)
      if (Object.values(missing).every((keys) => keys.length === 0)) console.log('✓ 所有語系的介面字串都齊全')
      for (const [locale, keys] of Object.entries(missing)) {
        if (keys.length === 0) continue
        console.log(`\n${locale}（${config.client.localeNames[locale]}）缺 ${keys.length} 個：`)
        for (const key of keys) console.log(`  ${key}  ← ${config.client.messages[config.client.defaultLocale][key]}`)
      }
      break
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP)
      break
    default:
      console.error(`不認得的指令：${command}\n\n${HELP}`)
      process.exitCode = 1
  }
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`)
  if (process.env.DEBUG) console.error(error)
  process.exitCode = 1
}
