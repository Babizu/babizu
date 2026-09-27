<script setup>
/**
 * 設定：外觀（淺色、深色、跟隨系統）與介面語言，收在頁首的一個按鈕裡。
 * 站台開放不只一種構詞搜尋實作時（站台設定 search.morphology.methods），也可以在這裡切換。
 * 都是少數幾個互斥的選項，用分段按鈕（ToggleGroup）一眼看完，不用下拉選單。
 */
import { MonitorIcon, MoonIcon, Settings2Icon, SunIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMorphMethod } from '@/composables/useMorphMethod.js'
import { useTheme } from '@/composables/useTheme.js'
import { msg, useI18n } from '@/i18n.js'

const { mode, setMode } = useTheme()
const { t, locale, locales, localeNames, setLocale } = useI18n()
const { method, methods, choosable, setMethod } = useMorphMethod()

/** 構詞搜尋的實作（docs/morph-grammar.md 第 5 節） @type {Record<string, string>} */
const METHOD_LABELS = { bcdp: msg('BCDP'), chart: msg('類 pika 剖析器') }

const THEMES = [
  { value: 'light', icon: SunIcon, labelKey: msg('淺色') },
  { value: 'dark', icon: MoonIcon, labelKey: msg('深色') },
  { value: 'auto', icon: MonitorIcon, labelKey: msg('跟隨系統') },
]

/** ToggleGroup 再按一次同一項會送出空值：保持原選擇 @param {unknown} value */
const onTheme = (value) => {
  if (value) setMode(/** @type {'light' | 'dark' | 'auto'} */ (value))
}
/** @param {unknown} value */
const onLocale = (value) => {
  if (value) setLocale(/** @type {string} */ (value))
}
/** @param {unknown} value */
const onMethod = (value) => {
  if (value) setMethod(/** @type {string} */ (value))
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="ghost" size="icon" class="shrink-0" :aria-label="choosable ? t('設定：外觀、介面語言與構詞搜尋方法') : t('設定：外觀與介面語言')">
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

      <section v-if="choosable" class="space-y-2" aria-labelledby="settings-morph-method">
        <h2 id="settings-morph-method" class="text-muted-foreground text-xs font-medium">{{ t('構詞搜尋方法') }}</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          class="grid w-full"
          :style="{ gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))` }"
          :model-value="method"
          :aria-label="t('構詞搜尋方法')"
          @update:model-value="onMethod"
        >
          <ToggleGroupItem v-for="m in methods" :key="m" :value="m" class="h-11 text-xs">
            {{ t(METHOD_LABELS[m] ?? m) }}
          </ToggleGroupItem>
        </ToggleGroup>
        <p class="text-muted-foreground text-xs text-pretty">{{ t('兩種實作找到的結果相同，可以比較速度（顯示在結果數旁）。') }}</p>
      </section>
    </PopoverContent>
  </Popover>
</template>
