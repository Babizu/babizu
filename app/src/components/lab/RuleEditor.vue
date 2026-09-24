<script setup>
/**
 * 規則與成本編輯器。所有修改立即反映在動態規劃表與詞圖搜尋上。
 */
import { PlusIcon, RotateCcwIcon, Trash2Icon } from '@lucide/vue'
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { t } from '@/i18n.js'
import { categoryLabel, formatDistance } from '@/lib/labels.js'

const props = defineProps({
  /** createLabState() 的 state（reactive，直接修改） */
  state: { type: Object, required: true },
  activeRuleCount: { type: Number, required: true },
})
const emit = defineEmits(['reset'])

/** 顯示名稱在模板裡用 t() 查（切換語系時即時更新） */
const COSTS = ['substitute', 'delete', 'insert', 'space']
const POSITIONS = ['any', 'initial', 'final']

const draft = ref({ source: '', target: '', weight: 0.1, position: 'any' })

function addCustom() {
  if (!draft.value.source && !draft.value.target) return
  props.state.custom.push({ ...draft.value, weight: Number(draft.value.weight) })
  draft.value = { source: '', target: '', weight: 0.1, position: 'any' }
}
</script>

<template>
  <div class="space-y-6 text-sm">
    <section>
      <h3 class="mb-3 font-medium">{{ t('lab.costs') }}</h3>
      <div class="space-y-4">
        <div v-for="c in COSTS" :key="c">
          <div class="mb-2 flex justify-between text-xs">
            <label :id="`cost-${c}`">{{ t(`lab.cost.${c}`) }}</label>
            <span class="font-mono tabular-nums">{{ formatDistance(state.costs[c]) }}</span>
          </div>
          <Slider
            :model-value="[state.costs[c]]"
            :min="0"
            :max="3"
            :step="0.1"
            :aria-labelledby="`cost-${c}`"
            @update:model-value="(v) => (state.costs[c] = v[0])"
          />
        </div>
      </div>
    </section>

    <section>
      <div class="mb-2 flex items-baseline justify-between">
        <h3 class="font-medium">{{ t('lab.rules') }}</h3>
        <span class="text-muted-foreground text-xs">{{ t('lab.activeRules', { count: activeRuleCount }) }}</span>
      </div>
      <div class="divide-y rounded-lg border">
        <details v-for="group in state.groups" :key="group.category" class="group/rule">
          <summary class="hover:bg-muted/50 flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 [&::-webkit-details-marker]:hidden">
            <Checkbox
              :model-value="group.enabled"
              :aria-label="t('lab.enableCategory', { category: categoryLabel(group.category) })"
              @click.stop
              @update:model-value="(v) => (group.enabled = v === true)"
            />
            <span class="flex-1" :class="!group.enabled && 'text-muted-foreground line-through'">{{ categoryLabel(group.category) }}</span>
            <span class="text-muted-foreground text-xs tabular-nums">{{ group.rules.length }}</span>
            <span class="text-muted-foreground text-xs transition-transform group-open/rule:rotate-90" aria-hidden="true">▸</span>
          </summary>
          <div class="space-y-1 px-3 pb-3">
            <p v-if="group.description" class="text-muted-foreground pb-1 text-xs">{{ group.description }}</p>
            <div v-for="(rule, k) in group.rules" :key="k" class="flex items-center gap-2">
              <code class="bg-muted min-w-0 flex-1 truncate rounded px-1.5 py-1 font-mono text-xs">
                {{ rule.source || '∅' }} ↔ {{ rule.target || '∅' }}
              </code>
              <select
                v-model="rule.position"
                class="border-input bg-background h-8 rounded-md border px-1 text-xs"
                :aria-label="t('lab.rulePosition', { rule: `${rule.source}↔${rule.target}` })"
              >
                <option v-for="p in POSITIONS" :key="p" :value="p">{{ t(`lab.position.${p}`) }}</option>
              </select>
              <Input
                v-model.number="rule.weight"
                type="number"
                min="0"
                step="0.1"
                class="h-8 w-16 px-2 text-xs"
                :aria-label="t('lab.ruleWeight', { rule: `${rule.source}↔${rule.target}` })"
              />
            </div>
          </div>
        </details>
      </div>
    </section>

    <section>
      <h3 class="mb-2 font-medium">{{ t('lab.customRules') }}</h3>
      <div v-for="(rule, k) in state.custom" :key="k" class="mb-1.5 flex items-center gap-2">
        <code class="bg-muted min-w-0 flex-1 truncate rounded px-1.5 py-1 font-mono text-xs">
          {{ rule.source || '∅' }} ↔ {{ rule.target || '∅' }} · {{ t(`lab.position.${rule.position}`) }} ·
          {{ rule.weight }}
        </code>
        <Button variant="ghost" size="icon-sm" :aria-label="t('lab.deleteRule', { rule: `${rule.source}↔${rule.target}` })" @click="state.custom.splice(k, 1)">
          <Trash2Icon />
        </Button>
      </div>
      <form class="grid grid-cols-[1fr_1fr_4rem] gap-2" @submit.prevent="addCustom">
        <Input v-model="draft.source" :placeholder="t('lab.sourcePlaceholder')" class="h-9" :aria-label="t('lab.ruleSource')" />
        <Input v-model="draft.target" :placeholder="t('lab.targetPlaceholder')" class="h-9" :aria-label="t('lab.ruleTarget')" />
        <Input v-model.number="draft.weight" type="number" min="0" step="0.1" class="h-9 px-2" :aria-label="t('lab.weight')" />
        <select v-model="draft.position" class="border-input bg-background col-span-2 h-9 rounded-md border px-2 text-sm" :aria-label="t('lab.position.label')">
          <option v-for="p in POSITIONS" :key="p" :value="p">{{ t(`lab.position.${p}`) }}</option>
        </select>
        <Button type="submit" variant="outline" size="icon" class="h-9 w-full" :aria-label="t('lab.addRule')"><PlusIcon /></Button>
      </form>
    </section>

    <Button variant="ghost" class="w-full" @click="emit('reset')"><RotateCcwIcon /> {{ t('lab.reset') }}</Button>
  </div>
</template>
