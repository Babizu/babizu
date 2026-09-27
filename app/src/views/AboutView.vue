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
      title: t('跨方言模糊搜尋'),
      text: t('依方言間系統性的語音對應加權計算距離，對應關係與書寫系統差異都算成極近的距離，不必先知道對方怎麼拼。'),
      example: firstPair ? `${firstPair[0]} → ${firstPair[1]}` : '',
    },
    {
      icon: BookMarkedIcon,
      title: t('每筆資料都查得到出處'),
      text: t('標示辭典頁碼、詞表列號、語料時間碼；有掃描圖的來源可以直接開原書頁面對照，引用格式一鍵複製。'),
      example: '',
    },
    {
      icon: AudioLinesIcon,
      title: t('聽得到的語料'),
      text: t('有錄音的句子可以直接播放，並附逐詞對譯，看得出每個詞素的意思。'),
      example: totals.value.audio ? t('{count} 段錄音', { count: formatCount(totals.value.audio) }) : '',
      // 沒有任何錄音的網站就不必宣傳這一項
      hidden: sources.value.length > 0 && totals.value.audio === 0,
    },
    {
      icon: LayersIcon,
      title: t('多個來源，一套格式'),
      text: t('辭典、詞表與錄音語料各自由獨立的轉接器轉成同一套標準格式，一次查詢就能橫跨全部來源比對。'),
      example: totals.value.records
        ? t('{sources} 個來源 · {records} 筆記錄', { sources: totals.value.sources, records: formatCount(totals.value.records) })
        : '',
    },
  ].filter((f) => !f.hidden),
)

const content = computed(() => (site.about ? tr(site.about) : ''))
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
    <h1 class="font-serif text-3xl font-bold tracking-tight">{{ t('關於本辭典') }}</h1>

    <!--
      特色一覽。刻意不做成有陰影的卡片：用髮絲線分隔的格線排版，
      與全站「工具書而非產品官網」的調性一致（見 docs/ui-guidelines.md）。
    -->
    <section class="bg-border border-border mt-8 grid gap-px border-y sm:grid-cols-2" aria-labelledby="h-features">
      <h2 id="h-features" class="sr-only">{{ t('特色') }}</h2>
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
