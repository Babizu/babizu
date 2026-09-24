<script setup>
/**
 * 行動裝置底部分頁列：拇指可及的主要導覽。桌面（md 以上）隱藏。
 */
import { useRoute } from 'vue-router'
import { useI18n } from '@/i18n.js'
import { NAV_ITEMS } from './nav.js'

const route = useRoute()
const { t } = useI18n()

/** @param {string} name */
const isActive = (name) =>
  route.name === name ||
  (name === 'sources' && route.name === 'browse') ||
  (name === 'search' && route.name === 'record')
</script>

<template>
  <nav
    class="bg-background/95 supports-[backdrop-filter]:bg-background/80 pb-safe fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur md:hidden"
    :aria-label="t('nav.main')"
  >
    <ul class="mx-auto grid max-w-md grid-cols-3">
      <li v-for="item in NAV_ITEMS" :key="item.name">
        <RouterLink
          :to="item.to"
          class="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors"
          :class="isActive(item.name) ? 'text-primary font-medium' : 'text-muted-foreground'"
          :aria-current="isActive(item.name) ? 'page' : undefined"
        >
          <component :is="item.icon" class="size-5" aria-hidden="true" />
          {{ t(item.labelKey) }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
