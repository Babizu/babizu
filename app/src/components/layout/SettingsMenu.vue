<script setup lang="ts">
/**
 * 設定：外觀（淺色、深色、跟隨系統）與介面語言，收在頁首的一個按鈕裡。
 * 兩者都是少數幾個互斥的選項，用分段按鈕（ToggleGroup）一眼看完，不用下拉選單。
 */
import { MonitorIcon, MoonIcon, Settings2Icon, SunIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSearchAlgorithm } from '@/composables/useSearchAlgorithm.ts'
import { useTheme } from '@/composables/useTheme.ts'
import { ALGORITHM_LABELS } from '@/lib/labels.ts'
import { msg, useI18n } from '@/i18n.ts'

const { mode, setMode } = useTheme()
const { algorithm, available: algorithmAvailable, setAlgorithm } = useSearchAlgorithm()
const ALGORITHMS = ['bcdp', 'csr'] as const
const { t, locale, locales, localeNames, setLocale } = useI18n()

const THEMES = [
  { value: 'light', icon: SunIcon, labelKey: msg('淺色') },
  { value: 'dark', icon: MoonIcon, labelKey: msg('深色') },
  { value: 'auto', icon: MonitorIcon, labelKey: msg('跟隨系統') },
]

/** ToggleGroup 再按一次同一項會送出空值：保持原選擇 */
const onTheme = (value: unknown) => {
  if (value) setMode(value as 'light' | 'dark' | 'auto')
}
const onLocale = (value: unknown) => {
  if (value) setLocale(value as string)
}
const onAlgorithm = (value: unknown) => {
  if (value === 'bcdp' || value === 'csr') setAlgorithm(value)
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="ghost" size="icon" class="shrink-0" :aria-label="t('設定：外觀與介面語言')">
        <Settings2Icon />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-72 space-y-4">
      <section class="space-y-2" aria-labelledby="settings-theme">
        <h2 id="settings-theme" class="text-muted-foreground text-xs font-medium">{{ t('外觀') }}</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          class="grid w-full grid-cols-3"
          :model-value="mode"
          :aria-label="t('外觀')"
          @update:model-value="onTheme"
        >
          <ToggleGroupItem v-for="item in THEMES" :key="item.value" :value="item.value" class="h-11 flex-col gap-1 text-xs">
            <component :is="item.icon" aria-hidden="true" />
            {{ t(item.labelKey) }}
          </ToggleGroupItem>
        </ToggleGroup>
      </section>

      <section v-if="locales.length > 1" class="space-y-2" aria-labelledby="settings-language">
        <h2 id="settings-language" class="text-muted-foreground text-xs font-medium">{{ t('介面語言') }}</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          class="grid w-full"
          :style="{ gridTemplateColumns: `repeat(${Math.min(locales.length, 3)}, minmax(0, 1fr))` }"
          :model-value="locale"
          :aria-label="t('介面語言')"
          @update:model-value="onLocale"
        >
          <ToggleGroupItem v-for="l in locales" :key="l" :value="l" :lang="l" class="h-11">
            {{ localeNames[l] }}
          </ToggleGroupItem>
        </ToggleGroup>
      </section>

      <!-- 模糊搜尋的核心演算法：站台設定了對應組檢索（實驗性）才有這一項 -->
      <section v-if="algorithmAvailable" class="space-y-2" aria-labelledby="settings-algorithm">
        <h2 id="settings-algorithm" class="text-muted-foreground text-xs font-medium">{{ t('模糊搜尋') }}</h2>
        <ToggleGroup type="single" variant="outline" class="grid w-full grid-cols-2" :model-value="algorithm" :aria-label="t('模糊搜尋')" @update:model-value="onAlgorithm">
          <ToggleGroupItem v-for="a in ALGORITHMS" :key="a" :value="a" class="h-auto min-h-11 flex-col gap-0 px-2 py-1 text-xs leading-tight">
            <span>{{ t(ALGORITHM_LABELS[a].label) }}</span>
            <span v-if="a === 'csr'" class="text-muted-foreground text-[10px] font-normal">{{ t(ALGORITHM_LABELS.csr.tag) }}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <p class="text-muted-foreground text-xs leading-relaxed">{{ t(ALGORITHM_LABELS[algorithm].hint) }}</p>
      </section>
    </PopoverContent>
  </Popover>
</template>
