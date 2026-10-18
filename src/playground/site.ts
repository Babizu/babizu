/**
 * @file 展示版的站台設定：建置時的設定（介面字串、語系、「關於」頁…）＋專案（名稱、語言變體、語言設定檔、範例）。
 *
 * 瀏覽器在載入前端程式之前就呼叫它（app/src/playground/runtime.ts），產生 `virtual:babizu/site` 的內容。
 */

import type { ClientSite } from '../site/client.ts'
import { localize, resolveVarieties } from '../site/varieties.ts'
import type { PlaygroundProject } from './project.ts'

/** 由專案產生站台設定（語言變體有誤時退回沒有變體，畫面照常顯示；建置前的檢查會指出問題） */
export function playgroundClientSite(base: ClientSite, project: PlaygroundProject): ClientSite {
  const { locales, defaultLocale } = base
  const errors: string[] = []
  const varieties = resolveVarieties(project.varieties ?? [], locales, defaultLocale, errors)
  const title = localize(project.title, locales, defaultLocale) ?? base.title
  const words = project.words ?? []
  const examples = project.examples?.length
    ? project.examples.map((e) => ({ q: e.q, note: localize(e.note, locales, defaultLocale) }))
    : words.slice(0, 3).map((w) => ({ q: w.text, note: null }))
  const pairs = project.lab?.pairs?.length ? project.lab.pairs : words.length >= 2 ? [[words[0].text, words[1].text] as [string, string]] : base.lab.pairs
  return {
    ...base,
    title,
    shortTitle: title,
    description: localize(project.description, locales, defaultLocale) ?? base.description,
    varieties: errors.length ? [] : varieties,
    examples,
    patternExamples: [],
    lab: {
      pairs,
      words: project.lab?.words ?? (words.length ? words.slice(0, 200).map((w) => w.text).join(' ') : base.lab.words),
      morph: { examples: project.profile.morphology ? (project.lab?.morph?.examples ?? []) : [], failures: [] },
    },
    profile: project.profile,
    csr: false,
    playground: true,
  }
}
