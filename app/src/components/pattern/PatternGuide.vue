<script setup>
/**
 * 「關於」頁的句型搜尋說明（錨點 #pattern）：寫法一覽、比對規則與可以點的例子。
 * 框架不寫死任何語言的詞，表中用「詞」「詞綴」等代稱；實際的例子來自站台設定 patternExamples。
 * 語言設定檔沒有構詞規格時，構詞樣式的幾列不顯示。完整規格見 docs/pattern-query.md。
 */
import { computed } from 'vue'
import { t, tr } from '@/i18n.js'
import { site } from '@/lib/labels.js'

const hasMorphology = Boolean(site.profile?.morphology)

/** 寫法一覽：morph 是構詞樣式（需要構詞規格） */
const ROWS = computed(() =>
  [
    { code: t('詞'), text: t('這個詞；依「模糊程度」容許方言與拼寫差異') },
    { code: t('"詞"'), text: t('拼寫完全相同；引號裡有空白時是連續的幾個詞') },
    { code: '_', text: t('任一個詞') },
    { code: t('詞…　…詞　…詞…'), text: t('只看拼寫：開頭、結尾、包含（… 也可以打成 ...）') },
    { code: t('詞綴-…　…-詞綴'), text: t('構詞：這個詞最外層的前綴、後綴是這些詞綴（= 與 - 相同）'), morph: true },
    { code: t('…-詞綴-…'), text: t('構詞：詞綴在任何一層都算（外側也寫 …）'), morph: true },
    { code: t('<中綴>…'), text: t('含這個中綴；中綴寫在哪裡都一樣'), morph: true },
    { code: '~…', text: t('有重疊'), morph: true },
    { code: t('詞綴-詞根'), text: t('由這個詞根加上詞綴而來（詞根依模糊程度比對）'), morph: true },
    { code: t('@詞'), text: t('這個詞的詞族：本身、相近拼寫、辭典標註的派生與自動派生') },
    { code: 'x?　x*　x+　x{2}　x{1,3}', text: t('可有可無、零個以上、一個以上、次數') },
    { code: '(a b)　(a|b)　a/b', text: t('分組、擇一') },
    { code: '^　$', text: t('句首、句尾') },
    { code: '!x', text: t('不是這個詞') },
    { code: 'A & B　A & !B', text: t('同一筆記錄都要有；不能有') },
  ].filter((r) => hasMorphology || !r.morph),
)

const examples = site.patternExamples ?? []
</script>

<template>
  <section id="pattern" class="mt-12 scroll-mt-20" aria-labelledby="h-pattern">
    <h2 id="h-pattern" class="font-serif text-2xl font-bold tracking-tight">{{ t('句型搜尋') }}</h2>
    <p class="text-muted-foreground mt-3 max-w-[65ch] leading-relaxed">
      {{ t('在搜尋框用下面的寫法描述一段句子，就能依詞序與構詞找例句，例如兩個詞中間隔了幾個詞、帶某個詞綴的詞後面接什麼。用到 {symbols} 時自動改用句型搜尋。', { symbols: '_ … " | & ^ $ @' }) }}
    </p>

    <div class="mt-6 overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">{{ t('句型的寫法') }}</caption>
        <thead>
          <tr class="text-muted-foreground border-b text-left text-xs">
            <th scope="col" class="py-2 pr-4 font-medium">{{ t('寫法') }}</th>
            <th scope="col" class="py-2 font-medium">{{ t('意思') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in ROWS" :key="r.code" class="border-b last:border-b-0">
            <td class="py-2 pr-4 align-top font-mono whitespace-nowrap">{{ r.code }}</td>
            <td class="py-2 align-top leading-relaxed">{{ r.text }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3 class="mt-8 font-semibold">{{ t('比對的規則') }}</h3>
    <ul class="text-muted-foreground mt-2 max-w-[65ch] list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
      <li>{{ t('與正規表達式相同：從左邊找起、量詞先比多的、找到的區間不重疊。_* 會延伸到同一句中最後一個接得上的地方。') }}</li>
      <li>{{ t('句子以句號、問號、驚嘆號分開；相鄰、句首與句尾都以句為單位。') }}</li>
      <template v-if="hasMorphology">
        <li>{{ t('構詞樣式比的是詞素：寫出同位詞素組中的任一個寫法，就找整組；寫在引號裡（"詞綴"-…）只找那一個寫法。組合的整體寫法會換成它的詞素。') }}</li>
        <li>{{ t('詞綴的寫法不在構詞規格中時，依方言規則找最接近的詞綴並提示；找不到時列出最接近的幾個。') }}</li>
        <li>{{ t('列出的前綴從最外層往內數、後綴也從最外層往內數，彼此要相連；和詞根之間可以有沒列出的詞素。要找不在最外層的詞綴，外側也寫 …，例如 …-詞綴-…。') }}</li>
        <li>{{ t('每個詞的拆法與「自動拆解」列出的相同（演算法推定），結果標成虛線框的「自動」。精確只取最好的拆法、不容許音變；標準也取差一點的次佳拆法（標「次佳」）、容許少量音變；寬鬆取全部。') }}</li>
        <li>{{ t('詞根寫成 … 與逐一寫出每個詞根，結果一定相同：兩者用同一個條件比對。') }}</li>
      </template>
      <li>{{ t('語法書例句的體例：(x) 可以省略、a/b 擇一、*x 是不合語法的說法（不參與比對）。') }}</li>
    </ul>

    <template v-if="examples.length">
      <h3 class="mt-8 font-semibold">{{ t('例子') }}</h3>
      <ul class="divide-border border-border mt-2 divide-y border-y">
        <li v-for="ex in examples" :key="ex.q">
          <RouterLink
            :to="{ name: 'search', query: { q: ex.q, m: 'pattern' } }"
            class="hover:bg-muted/60 flex min-h-11 flex-col gap-0.5 px-1 py-2 transition-colors sm:flex-row sm:items-baseline sm:gap-4"
          >
            <span class="native-text text-primary font-mono text-sm sm:w-48 sm:shrink-0">{{ ex.q }}</span>
            <span class="text-muted-foreground text-sm">{{ tr(ex.note) }}</span>
          </RouterLink>
        </li>
      </ul>
    </template>
  </section>
</template>
