/**
 * @file 整張卡片可以點、卡片裡的文字又能拖曳反白與複製（搜尋結果、句型結果、檢查清單、記錄頁的列）。
 *
 * 以前的寫法是「主要連結的 ::after 撐滿整張卡片」：滑鼠按在卡片任何地方都落在連結上，
 * 拖曳就變成拖出網址，釋義、例句都選不到。改成卡片自己處理點擊（`v-card-link="路由"`）：
 * - 點在卡片中的連結、按鈕、表單控制項上時交給它們（主要文字本身就是連結，照常導覽）；
 * - 剛在卡片中反白了文字（拖曳、雙擊）時不開啟，也擋下連結本身的導覽，讓讀者可以複製；
 * - Ctrl／⌘／Shift 點擊與滑鼠中鍵在新分頁開啟，與一般連結相同。
 * 卡片中的連結都設成 draggable="false"：拖曳時是反白文字，不是拖出網址。
 * 主要文字仍是真正的連結，鍵盤操作、螢幕報讀、右鍵「複製連結」都照舊。
 * 卡片加上 cursor-pointer；要讓主要連結在滑過卡片時也畫底線，卡片加 group、連結用 group-hover:underline。
 */

import { router } from '@/router.ts'
import type { RouteLocationRaw } from 'vue-router'
import type { Directive } from 'vue'

/** 卡片中自己會處理點擊的元素 */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"], [role="tab"]'

const states: WeakMap<HTMLElement, {to: unknown, off: () => void}> = new WeakMap()

/**
 * 卡片中有沒有反白的文字（剛拖曳或雙擊選取）。
 */
function hasSelectionIn(el: HTMLElement) {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return false
  return el.contains(sel.anchorNode) || el.contains(sel.focusNode)
}

/**
 * 點擊的位置是不是卡片中自己會處理點擊的元素。
 */
function onInteractive(el: HTMLElement, target: EventTarget | null) {
  const hit = target instanceof Element ? target.closest(INTERACTIVE) : null
  return Boolean(hit && hit !== el && el.contains(hit))
}

/**
 * @param to vue-router 的路由
 */
function open(to: unknown, newTab: boolean) {
  const route = to as RouteLocationRaw
  if (newTab) window.open(router.resolve(route).href, '_blank', 'noopener')
  else router.push(route)
}

/** @param el 卡片中的連結都不能拖曳（拖曳是反白文字） */
function markLinks(el: HTMLElement) {
  for (const a of el.querySelectorAll('a')) a.draggable = false
}

export const vCardLink: Directive<HTMLElement, unknown> = {
  mounted(el, binding) {
    /** 反白了文字時擋下任何導覽（含主要連結本身）；捕獲階段先於連結的處理 */
    const guard = (e: MouseEvent) => {
      if (hasSelectionIn(el)) e.preventDefault()
    }
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || onInteractive(el, e.target)) return
      open((states.get(el) as {to: unknown}).to, e.ctrlKey || e.metaKey || e.shiftKey)
    }
    /** 中鍵：新分頁（點在連結上時瀏覽器自己會處理） */
    const aux = (e: MouseEvent) => {
      if (e.button !== 1 || onInteractive(el, e.target)) return
      e.preventDefault()
      open((states.get(el) as {to: unknown}).to, true)
    }
    el.addEventListener('click', guard, true)
    el.addEventListener('click', click)
    el.addEventListener('auxclick', aux)
    el.classList.add('cursor-pointer')
    markLinks(el)
    states.set(el, {
      to: binding.value,
      off: () => {
        el.removeEventListener('click', guard, true)
        el.removeEventListener('click', click)
        el.removeEventListener('auxclick', aux)
      },
    })
  },
  updated(el, binding) {
    const state = states.get(el)
    if (state) state.to = binding.value
    markLinks(el)
  },
  unmounted(el) {
    states.get(el)?.off()
    states.delete(el)
  },
}
