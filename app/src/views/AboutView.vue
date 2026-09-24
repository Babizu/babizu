<script setup>
/**
 * 關於：框架提供的特色一覽＋站台自己的說明（站台設定 about，Markdown 依語系分檔）。
 *
 * 站台說明是可信任的內容（來自站台自己的儲存庫），建置時轉成 HTML 後直接插入。
 * 內容裡可以用：
 * - `#/sources`、`#/lab` 這類連結（hash 路由，不會重新載入頁面）
 * - `<span class="variety-badge variety-<代碼>">名稱</span>` 顯示和全站一致的方言徽章
 */
import { AudioLinesIcon, BookMarkedIcon, LayersIcon, WavesIcon } from '@lucide/vue'
import { computed } from 'vue'
import { useSources } from '@/composables/useSources.js'
import { useI18n } from '@/i18n.js'
import { formatCount, site } from '@/lib/labels.js'

const { sources } = useSources()
const { t, tr } = useI18n()

/** 各來源加總；資料一變數字就跟著變，不要寫死 */
const totals = computed(() => {
  let records = 0
  let audio = 0
  for (const s of sources.value) {
    records += s.stats?.records ?? 0
    audio += s.stats?.audio ?? 0
  }
  return { records, audio, sources: sources.value.length }
})

const firstPair = site.lab.pairs[0]

/** 四項特色，放在最前面讓第一次來的讀者知道這裡能做什麼 */
const FEATURES = computed(() =>
  [
    {
      icon: WavesIcon,
      title: t('about.fuzzy.title'),
      text: t('about.fuzzy.text'),
      example: firstPair ? `${firstPair[0]} → ${firstPair[1]}` : '',
    },
    {
      icon: BookMarkedIcon,
      title: t('about.provenance.title'),
      text: t('about.provenance.text'),
      example: '',
    },
    {
      icon: AudioLinesIcon,
      title: t('about.audio.title'),
      text: t('about.audio.text'),
      example: totals.value.audio ? t('about.audio.count', { count: formatCount(totals.value.audio) }) : '',
      // 沒有任何錄音的網站就不必宣傳這一項
      hidden: sources.value.length > 0 && totals.value.audio === 0,
    },
    {
      icon: LayersIcon,
      title: t('about.sources.title'),
      text: t('about.sources.text'),
      example: totals.value.records
        ? t('about.sources.count', { sources: totals.value.sources, records: formatCount(totals.value.records) })
        : '',
    },
  ].filter((f) => !f.hidden),
)

const content = computed(() => (site.about ? tr(site.about) : ''))
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
    <h1 class="font-serif text-3xl font-bold tracking-tight">{{ t('about.title') }}</h1>

    <!--
      特色一覽。刻意不做成有陰影的卡片：用髮絲線分隔的格線排版，
      與全站「工具書而非產品官網」的調性一致（見 docs/ui-guidelines.md）。
    -->
    <section class="bg-border border-border mt-8 grid gap-px border-y sm:grid-cols-2" aria-labelledby="h-features">
      <h2 id="h-features" class="sr-only">{{ t('about.features') }}</h2>
      <!-- gap-px 加上底層的 bg-border，分隔線自己就出來了，欄數怎麼變都不用改 -->
      <div v-for="f in FEATURES" :key="f.title" class="bg-background px-1 py-5 sm:px-5">
        <div class="flex items-center gap-2.5">
          <component :is="f.icon" class="text-primary size-5 shrink-0" aria-hidden="true" />
          <h3 class="font-semibold">{{ f.title }}</h3>
        </div>
        <p class="text-muted-foreground mt-2 text-sm leading-relaxed">{{ f.text }}</p>
        <p v-if="f.example" class="native-text text-foreground/70 mt-2 text-sm tabular-nums">{{ f.example }}</p>
      </div>
    </section>

    <!-- 站台自己的說明（Markdown） -->
    <!-- eslint-disable-next-line vue/no-v-html -- 內容來自站台自己的儲存庫，建置時轉成 HTML -->
    <div v-if="content" class="site-content mt-10" v-html="content" />
  </div>
</template>
