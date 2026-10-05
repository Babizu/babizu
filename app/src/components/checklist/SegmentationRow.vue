<script setup>
/**
 * 檢查清單：人工拆解與句型搜尋的構詞樣式不一致的一筆記錄（babizu/search 的 Checklist.segmentationPage）。
 *
 * 左欄是記錄與它的人工拆解（詞根不在詞庫中時標出來：補上條目常常就拆得到）；右欄逐一列出拆解中的詞綴
 * 搜尋比不比得到（✓ 比到、✗ 漏、? 規格沒有），搜尋比到、拆解沒有的詞綴（誤配），以及搜尋依這個模糊程度
 * 取到的拆法（比對的就是這些）。詞綴可以點，直接以那個構詞樣式搜尋。
 */
import { computed } from 'vue'
import MetaTag from '@/components/common/MetaTag.vue'
import { useSources } from '@/composables/useSources.js'
import { msg, t } from '@/i18n.js'
import { formatDistance, morphSummary, recordRoute } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  /** Checklist.segmentationPage 的一項 */
  item: { type: Object, required: true },
  /** 比對用的模糊程度（點詞綴搜尋時沿用） */
  fuzziness: { type: String, default: 'normal' },
})

const { shortTitle } = useSources()

/** 以構詞樣式搜尋（模糊程度與這份對照相同） @param {string} query */
const searchRoute = (query) => ({ name: 'search', query: { q: query, ...(props.fuzziness === 'normal' ? {} : { fz: props.fuzziness }) } })

/** 拆解中的詞綴的寫法（與構詞樣式相同的符號） @param {{type: string, form: string}} a */
const affixText = (a) => (a.type === 'prefix' ? `${a.form}-` : a.type === 'suffix' ? `-${a.form}` : `<${a.form}>`)

const STATUS = {
  match: { glyph: '✓', label: msg('比到'), class: 'text-muted-foreground' },
  miss: { glyph: '✗', label: msg('漏'), class: 'border-destructive/40 text-destructive' },
  unknown: { glyph: '?', label: msg('規格沒有'), class: 'text-muted-foreground border-dashed' },
}
const affixes = computed(() => props.item.affixes.map((/** @type {any} */ a) => ({ ...a, text: affixText(a), status: STATUS[/** @type {keyof typeof STATUS} */ (a.status)] })))
const CHIP = 'inline-flex min-h-8 items-center gap-1 rounded-sm border px-2 text-sm'
</script>

<template>
  <li class="grid gap-x-8 gap-y-3 py-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
    <!-- 左：記錄與人工拆解 -->
    <div class="min-w-0">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="native-text text-xl leading-snug font-semibold">
          <RouterLink :to="recordRoute(item.doc.id)" class="hover:underline" :title="t('開啟這筆記錄')">{{ item.doc.text }}</RouterLink>
        </h3>
        <span class="text-muted-foreground text-xs">{{ shortTitle(item.doc.source) }}</span>
      </div>
      <p class="mt-1.5 text-sm">
        <span class="text-muted-foreground text-xs">{{ t('人工拆解') }}</span>
        <code class="bg-muted native-text ml-2 rounded px-1.5 py-0.5">{{ item.segmentation }}</code>
      </p>
      <p v-if="item.doc.zh || item.doc.en" class="gloss-zh text-muted-foreground mt-1 line-clamp-2 text-xs">{{ item.doc.zh || item.doc.en }}</p>
      <p v-if="item.root && !item.rootInLexicon" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <MetaTag variant="soft" :title="t('人工拆解中的詞根不是詞庫中的詞：補上這個詞根的條目，搜尋常常就拆得到')">
          <span aria-hidden="true" class="font-mono">∅</span>{{ t('詞根「{root}」不在詞庫中', { root: item.root }) }}
        </MetaTag>
        <RouterLink :to="{ name: 'search', query: { q: item.root } }" class="text-primary hover:underline">{{ t('搜尋相近的詞') }} →</RouterLink>
      </p>
    </div>

    <!-- 右：詞綴逐一比對、誤配、搜尋取到的拆法 -->
    <div class="min-w-0 space-y-2.5 lg:border-l lg:pl-8">
      <div>
        <p class="text-muted-foreground mb-1 text-xs">{{ t('拆解中的詞綴') }}</p>
        <ul class="flex flex-wrap gap-1.5">
          <li v-for="(a, k) in affixes" :key="k">
            <RouterLink
              v-if="a.query"
              :to="searchRoute(a.query)"
              :class="cn(CHIP, 'bg-card hover:bg-muted transition-colors', a.status.class)"
              :title="t('{label}：以 {query} 搜尋', { label: t(a.status.label), query: a.query })"
            >
              <span aria-hidden="true" class="font-mono">{{ a.status.glyph }}</span>
              <span class="native-text">{{ a.text }}</span>
              <span class="sr-only">{{ t(a.status.label) }}</span>
            </RouterLink>
            <span v-else :class="cn(CHIP, a.status.class)" :title="t('構詞規格中沒有這個詞綴（或它是幾個詞素的組合寫法），不比')">
              <span aria-hidden="true" class="font-mono">{{ a.status.glyph }}</span>
              <span class="native-text">{{ a.text }}</span>
              <span class="text-xs">{{ t(a.status.label) }}</span>
            </span>
          </li>
        </ul>
      </div>
      <div v-if="item.extras.length">
        <p class="text-muted-foreground mb-1 text-xs">{{ t('搜尋比到、拆解沒有（誤配）') }}</p>
        <ul class="flex flex-wrap gap-1.5">
          <li v-for="x in item.extras" :key="x.query">
            <RouterLink :to="searchRoute(x.query)" :class="cn(CHIP, 'bg-card hover:bg-muted border-primary/40 transition-colors')" :title="t('以 {query} 搜尋', { query: x.query })">
              <span aria-hidden="true" class="font-mono">+</span><span class="native-text">{{ x.label }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
      <div>
        <p class="text-muted-foreground mb-1 text-xs">{{ t('搜尋取到的拆法') }}</p>
        <p v-if="!item.parses.length" class="text-muted-foreground text-sm">{{ t('沒有拆法：自動拆解在詞庫中找不到詞根') }}</p>
        <ul v-else class="space-y-0.5 text-sm">
          <li v-for="(p, k) in item.parses" :key="k" class="flex flex-wrap items-baseline gap-x-2">
            <span class="native-text">{{ morphSummary({ stem: p.root, steps: p.steps }) }}</span>
            <MetaTag v-if="p.virtual">{{ t('詞庫外的詞根') }}</MetaTag>
            <span class="text-muted-foreground font-mono text-xs tabular-nums">{{ formatDistance(p.cost) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </li>
</template>
