<script setup>
/**
 * 頂端列：網站名稱、主選單（桌面）、介面語系、深色模式切換。
 * 行動裝置的主選單在底部分頁列（MobileTabBar）。
 */
import { LanguagesIcon, MoonIcon, SunIcon } from '@lucide/vue'
import { useRoute } from 'vue-router'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/composables/useTheme.js'
import { useI18n } from '@/i18n.js'
import { site } from '@/lib/labels.js'
import { NAV_ITEMS } from './nav.js'

const route = useRoute()
const { isDark, toggle } = useTheme()
const { t, tr, locale, locales, localeNames, setLocale } = useI18n()

/** 站徽（站台 public/ 目錄中的檔案，與 index.html 的 favicon 同一個），依部署路徑組出網址 */
const iconUrl = site.icon ? `${import.meta.env.BASE_URL}${site.icon}` : null
const multilingual = locales.length > 1

/** @param {string} name */
const isActive = (name) => route.name === name || (name === 'sources' && route.name === 'browse')

/** @param {Event} event */
const onLocaleChange = (event) => setLocale(/** @type {HTMLSelectElement} */ (event.target).value)
</script>

<template>
  <header class="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40 border-b backdrop-blur">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
      <RouterLink :to="{ name: 'search' }" class="flex min-w-0 items-center gap-2.5" :aria-label="t('app.home')">
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

      <nav class="ml-auto hidden items-center gap-1 md:flex" :aria-label="t('nav.main')">
        <RouterLink
          v-for="item in NAV_ITEMS"
          :key="item.name"
          :to="item.to"
          class="hover:bg-muted rounded-md px-3 py-2 text-sm transition-colors"
          :class="isActive(item.name) ? 'text-foreground font-medium' : 'text-muted-foreground'"
          :aria-current="isActive(item.name) ? 'page' : undefined"
        >
          {{ t(item.labelKey) }}
        </RouterLink>
      </nav>

      <!-- 介面語系：原生 select，鍵盤、螢幕閱讀器與手機都不用另外處理 -->
      <div v-if="multilingual" class="relative ml-auto shrink-0 md:ml-0">
        <LanguagesIcon
          class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <select
          :value="locale"
          :aria-label="t('app.language')"
          class="hover:bg-muted focus-visible:ring-ring/50 h-9 max-w-32 cursor-pointer appearance-none rounded-md bg-transparent pr-2 pl-8 text-sm outline-none focus-visible:ring-[3px]"
          @change="onLocaleChange"
        >
          <option v-for="l in locales" :key="l" :value="l">{{ localeNames[l] }}</option>
        </select>
      </div>

      <Button
        variant="ghost"
        size="icon"
        class="shrink-0"
        :class="multilingual ? '' : 'ml-auto md:ml-0'"
        :aria-label="isDark ? t('app.lightMode') : t('app.darkMode')"
        @click="toggle()"
      >
        <SunIcon v-if="isDark" />
        <MoonIcon v-else />
      </Button>
    </div>
  </header>
</template>
