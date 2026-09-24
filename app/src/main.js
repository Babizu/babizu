/**
 * @file 網站進入點。
 */

// 族語詞形與標題用的襯線體。Gentium Book Plus 是 SIL 為語言學出版設計的字體，
// latin-ext 子集涵蓋本辭典會用到的音標與附加符號（ə ʔ ŋ ɨ ā é ū́）。
// 各子集都有 unicode-range，瀏覽器只會下載實際用到的部分。
import '@fontsource/gentium-book-plus/400.css'
import '@fontsource/gentium-book-plus/700.css'
import '@fontsource/gentium-book-plus/400-italic.css'
import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'

createApp(App).use(router).mount('#app')
