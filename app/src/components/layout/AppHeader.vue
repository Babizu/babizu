<script setup>
/**
 * 頂端列：網站名稱、主選單（桌面）、設定（外觀與介面語言，SettingsMenu）。
 * 行動裝置的主選單在底部分頁列（MobileTabBar）。
 */
import { useRoute } from 'vue-router'
import { useI18n } from '@/i18n.js'
import { site } from '@/lib/labels.js'
import { NAV_ITEMS } from './nav.js'
import SettingsMenu from './SettingsMenu.vue'

const route = useRoute()
const { t, tr } = useI18n()

/** 站徽（站台 public/ 目錄中的檔案，與 index.html 的 favicon 同一個），依部署路徑組出網址 */
const iconUrl = site.icon ? `${import.meta.env.BASE_URL}${site.icon}` : null

/** @param {string} name */
const isActive = (name) => route.name === name || (name === 'sources' && route.name === 'browse')
</script>

<template>
  <header class="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40 border-b backdrop-blur">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
      <RouterLink :to="{ name: 'search' }" class="flex min-w-0 items-center gap-2.5" :aria-label="t('回到搜尋頁')">
        <img
          v-if="iconUrl"
          :src="iconUrl"
          alt=""
          width="32"
          height="32"
          class="border-border size-8 shrink-0 rounded-sm border object-cover"
          aria-hidden="true"
        />
        <span class="truncate font-serif text-lg font-bold tracking-tight">
          <span class="sm:hidden">{{ tr(site.shortTitle) }}</span>
          <span class="hidden sm:inline">{{ tr(site.title) }}</span>
        </span>
      </RouterLink>

      <nav class="ml-auto hidden items-center gap-1 md:flex" :aria-label="t('主選單')">
        <RouterLink
          v-for="item in NAV_ITEMS"
          :key="item.name"
          :to="item.to"
          class="hover:bg-muted relative rounded-md px-3 py-2 text-sm transition-colors"
          :class="
            isActive(item.name)
              ? 'text-foreground after:bg-primary font-medium after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5'
              : 'text-muted-foreground hover:text-foreground'
          "
          :aria-current="isActive(item.name) ? 'page' : undefined"
        >
          {{ t(item.labelKey) }}
        </RouterLink>
      </nav>

      <div class="ml-auto shrink-0 md:ml-0">
        <SettingsMenu />
      </div>
    </div>
  </header>
</template>
