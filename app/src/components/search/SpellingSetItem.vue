<script setup>
/**
 * 搜尋結果中的同形詞組：不同來源（或同一來源的同形異義詞）寫法完全相同的詞，詞形只寫一次，
 * 底下每筆記錄一列：釋義與方言在上、出處在下（見 babizu/search 的 family.js「同形詞組」）。
 *
 * 版面與詞條家族同一套語彙：縮排＋左側細線表示「屬於上面那一列」。差別在家族的子項目是不同的詞形，
 * 同形詞組的每一列是同一個詞在不同來源的說法，所以不再重複詞形，改以釋義當每一列的主體。
 *
 * 命中標籤（≈ 距離、自動拆解…）每筆都一樣時放在詞形旁，只寫一次；不一樣時（例如一筆是以其他寫法命中）才放在各列。
 * 也在某個詞條家族裡的記錄（kita- 條下的 mikita）標出「也列在 kita- 條下」：家族本身照樣在結果中。
 */
import { computed } from 'vue'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import { useSources } from '@/composables/useSources.js'
import { t } from '@/i18n.js'
import { recordRoute, unitLabel } from '@/lib/labels.js'
import HitTags from './HitTags.vue'
import ResultCitation from './ResultCitation.vue'

const props = defineProps({
  /** EntryGroup.spelling：{ text, members: [{ doc, hit, family }] } */
  set: { type: Object, required: true },
  query: { type: String, default: '' },
})

const { shortTitle } = useSources()
const members = computed(() => props.set.members)

/** 命中方式的簽名：一樣的話標籤只放在詞形旁 @param {any} hit */
const signature = (hit) => [hit.kind, hit.matchType, hit.distance, hit.term, hit.analysis ? JSON.stringify(hit.analysis.steps ?? null) : ''].join('|')
const sharedTags = computed(() => new Set(members.value.map((/** @type {any} */ m) => signature(m.hit))).size === 1)
</script>

<template>
  <article class="px-3 py-3 sm:px-4" data-spelling-set>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h3 class="native-text text-lg leading-snug font-semibold">{{ set.text }}</h3>
      <HitTags v-if="sharedTags" :hit="members[0].hit" :query="query" />
      <span class="text-muted-foreground text-xs tabular-nums">{{ t('{count} 筆', { count: members.length }) }}</span>
    </div>

    <ul class="border-border mt-1.5 ml-1 space-y-0.5 border-l pl-1.5 sm:pl-2">
      <li
        v-for="m in members"
        :key="m.doc.id"
        class="hover:bg-muted/50 relative flex items-start gap-3 rounded-md px-2 py-1.5 transition-colors"
      >
        <div class="min-w-0 flex-1 space-y-0.5">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RouterLink
              :to="recordRoute(m.doc.id)"
              class="gloss-zh min-w-0 text-[15px] after:absolute after:inset-0 hover:underline"
              :aria-label="`${set.text} · ${shortTitle(m.doc.source)} · ${m.doc.zh || m.doc.en}`"
            >
              <span v-if="m.doc.zh">{{ m.doc.zh }}</span>
              <span v-if="m.doc.en" class="text-muted-foreground" :class="m.doc.zh && 'ml-2'">{{ m.doc.en }}</span>
              <span v-if="m.doc.nan" class="text-muted-foreground ml-2 text-sm">{{ t('臺：') }}{{ m.doc.nan }}</span>
              <span v-if="!m.doc.zh && !m.doc.en" class="text-muted-foreground">{{ t('（沒有釋義）') }}</span>
            </RouterLink>
            <DialectBadge v-for="d in m.doc.dialects" :key="d" :dialect="d" />
            <MetaTag v-if="m.doc.unit !== 'word'">{{ unitLabel(m.doc.unit) }}</MetaTag>
            <HitTags v-if="!sharedTags" :hit="m.hit" :query="query" />
            <MetaTag v-if="m.family" :title="t('這筆記錄在搜尋結果中也列在 {root} 的詞條家族裡', { root: m.family.text })">
              {{ t('也列在 {root} 條下', { root: m.family.text }) }}
            </MetaTag>
          </div>
          <ResultCitation :source="m.doc.source" :citation="m.doc.citation" :status="m.doc.status" />
        </div>
        <div v-if="m.doc.audio" class="relative z-10 shrink-0 self-center">
          <AudioButton :play-key="m.doc.id" :src="m.doc.audio" :label="set.text" />
        </div>
      </li>
    </ul>
  </article>
</template>
