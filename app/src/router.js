/**
 * @file 路由。
 *
 * 使用 hash 模式（網址形如 /#/?q=alaw），網站放在任何靜態主機都不需要伺服器端設定。
 * 搜尋頁就是首頁，所以只有它預先載入，其餘頁面延遲載入以縮短首次開啟時間。
 * 舊的 /search 網址會轉向首頁，既有的連結與書籤不會失效。
 */

import { createRouter, createWebHashHistory } from 'vue-router'
import { msg } from './i18n.js'
import { pageTitle } from './composables/usePageTitle.js'
import SearchView from './views/SearchView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // 搜尋就是首頁：這是一本辭典，使用者一進來就是要查東西。
    // 沒有查詢字串時，搜尋頁會顯示說明與範例（見 SearchView 的空狀態）。
    { path: '/', name: 'search', component: SearchView, meta: { titleKey: null } },
    // 舊網址：連同查詢字串一起帶到首頁，既有的連結與書籤才不會失效
    { path: '/search', redirect: (to) => ({ name: 'search', query: to.query }) },
    {
      path: '/r/:source/:localId',
      name: 'record',
      component: () => import('./views/RecordView.vue'),
      meta: { titleKey: msg('詞條', '頁面標題') },
    },
    {
      path: '/sources',
      name: 'sources',
      component: () => import('./views/SourcesView.vue'),
      meta: { titleKey: msg('資料來源') },
    },
    {
      path: '/sources/:source/list',
      name: 'source-list',
      component: () => import('./views/SourceListView.vue'),
      meta: { titleKey: msg('詞彙清單') },
    },
    {
      path: '/sources/:source/:shard?',
      name: 'browse',
      component: () => import('./views/BrowseView.vue'),
      meta: { titleKey: msg('瀏覽') },
    },
    {
      path: '/lab',
      name: 'lab',
      component: () => import('./views/LabView.vue'),
      meta: { titleKey: msg('演算法實驗室') },
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('./views/AboutView.vue'),
      meta: { titleKey: msg('關於') },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('./views/NotFoundView.vue'),
      meta: { titleKey: msg('找不到頁面') },
    },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    // 同一頁只改查詢參數（例如切換篩選）時不捲回頂端
    if (to.path === from.path) return false
    return { top: 0 }
  },
})

// 換頁時清掉上一頁自訂的標題（例如詞條頁的詞形）；實際的 document.title 由 usePageTitle 依語系組出
router.afterEach(() => {
  pageTitle.value = null
})
