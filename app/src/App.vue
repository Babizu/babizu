<script setup>
/**
 * 版面外框：頂端列、主內容、行動裝置底部分頁列、全站通知。
 * 一進站就在背景載入搜尋索引，使用者搜尋時通常已就緒。
 */
import { onMounted } from 'vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import MobileTabBar from '@/components/layout/MobileTabBar.vue'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useDocumentTitle } from '@/composables/usePageTitle.js'
import { useSearchIndex } from '@/composables/useSearchIndex.js'
import { useI18n } from '@/i18n.js'
import { site } from '@/lib/labels.js'

const { load } = useSearchIndex()
const { t, tr } = useI18n()
useDocumentTitle()
onMounted(() => {
  // 讓首屏先畫完再載入索引
  const idle = window.requestIdleCallback ?? ((/** @type {() => void} */ fn) => setTimeout(fn, 200))
  idle(() => load())
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex min-h-dvh flex-col">
      <a
        href="#main"
        class="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {{ t('app.skipToContent') }}
      </a>
      <AppHeader />
      <main id="main" class="flex-1 pb-20 md:pb-0">
        <RouterView />
      </main>
      <footer class="text-muted-foreground mx-auto hidden w-full max-w-6xl px-6 py-8 text-xs md:block">
        {{ site.footer ? tr(site.footer) : `${tr(site.title)} · ${t('app.footer')}` }}
      </footer>
      <MobileTabBar />
    </div>
    <Toaster position="top-center" />
  </TooltipProvider>
</template>
