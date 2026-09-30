<script setup>
/**
 * 詞條家族中的一個子項目（詞形、例句、另立的衍生詞條），比詞條列精簡：
 * 出處與詞條相同，不再重複；另立條目只標「另立條目」，出處放在提示中。
 * 本身沒有命中的列（只是為了看出上下層關係）以淡色顯示，沒有命中標籤。
 *
 * 標籤：
 * - 完全相符的列標「完全相符」：單獨的詞條列不需要（排在最前面就是它），但在家族裡，
 *   讀者要看得出「整個詞條排上來是因為這一列」
 * - 以詞根身分命中的列（辭典標註它衍生自查詢的詞根）不加命中標籤：
 *   那是詞根命中的連帶結果，說明已經在詞條那一列，樹狀排列也看得出它屬於哪個詞根
 */
import { computed } from 'vue'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import { t } from '@/i18n.js'
import { displayHit } from '@/lib/entry-groups.js'
import { recordRoute, unitLabel } from '@/lib/labels.js'
import { DICTIONARY_KINDS } from '@babizu/search/scoring.js'
import HitTags from './HitTags.vue'

const props = defineProps({
  /** EntryNode：{ doc, hit, also, children } */
  node: { type: Object, required: true },
  query: { type: String, default: '' },
})

const doc = computed(() => props.node.doc)
const hit = computed(() => displayHit(props.node))
// 經由辭典構詞關係命中的子項目不加標籤：樹狀排列已經看得出關係
const showTags = computed(() => hit.value !== null && !DICTIONARY_KINDS.has(hit.value.kind))
const exact = computed(() => showTags.value && hit.value.matchType === 'fuzzy' && hit.value.distance === 0)
const showUnit = computed(() => doc.value.unit !== 'word' && doc.value.unit !== 'sentence')
</script>

<template>
  <div class="hover:bg-muted/50 relative flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors">
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <RouterLink
          :to="recordRoute(doc.id)"
          class="native-text leading-snug after:absolute after:inset-0 hover:underline"
          :class="hit ? 'font-medium' : 'text-muted-foreground'"
        >
          {{ doc.text }}
        </RouterLink>
        <DialectBadge v-for="d in doc.dialects" :key="d" :dialect="d" />
        <MetaTag v-if="showUnit">{{ unitLabel(doc.unit) }}</MetaTag>
        <MetaTag v-if="exact" variant="soft">{{ t('完全相符') }}</MetaTag>
        <HitTags v-else-if="showTags" :hit="hit" :query="query" :show-root-kind="false" />
        <MetaTag v-if="doc.role === 'head'" :title="doc.citation">{{ t('另立條目') }}</MetaTag>
        <!-- 寫法相同、另立的條目：標籤本身是連結，點了進入那個條目 -->
        <RouterLink
          v-for="a in node.also"
          :key="a.doc.id"
          :to="recordRoute(a.doc.id)"
          class="relative z-10 inline-flex rounded-sm hover:underline"
          :title="a.doc.citation"
        >
          <MetaTag class="hover:text-foreground cursor-pointer">{{ t('另立條目') }}</MetaTag>
        </RouterLink>
      </div>
      <p v-if="doc.zh || doc.en" class="gloss-zh text-sm" :class="!hit && 'text-muted-foreground'">
        <span v-if="doc.zh">{{ doc.zh }}</span>
        <span v-if="doc.en" class="text-muted-foreground" :class="doc.zh && 'ml-2'">{{ doc.en }}</span>
      </p>
    </div>
    <div v-if="doc.audio" class="relative z-10 shrink-0 self-center">
      <AudioButton :play-key="doc.id" :src="doc.audio" :label="doc.text" />
    </div>
  </div>
</template>
