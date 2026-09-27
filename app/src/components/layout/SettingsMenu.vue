<script setup>
/**
 * 設定：外觀（淺色、深色、跟隨系統）與介面語言，收在頁首的一個按鈕裡。
 * 兩者都是少數幾個互斥的選項，用分段按鈕（ToggleGroup）一眼看完，不用下拉選單。
 */
import { MonitorIcon, MoonIcon, Settings2Icon, SunIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTheme } from '@/composables/useTheme.js'
import { msg, useI18n } from '@/i18n.js'

const { mode, setMode } = useTheme()
const { t, locale, locales, localeNames, setLocale } = useI18n()

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
    </PopoverContent>
  </Popover>
</template>
