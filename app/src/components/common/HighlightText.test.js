import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HighlightText from './HighlightText.vue'

describe('HighlightText', () => {
  it('族語模式：以搜尋鍵比對整詞（含構詞部分與附加符號）', () => {
    const wrapper = mount(HighlightText, {
      props: { text: 'imini ka tshay=a Akhéhan?', terms: ['tshay', 'akhéhan'] },
    })
    expect(wrapper.findAll('mark').map((m) => m.text())).toEqual(['tshay=a', 'Akhéhan'])
    expect(wrapper.text()).toBe('imini ka tshay=a Akhéhan?')
  })

  it('一般模式：不分大小寫比對子字串', () => {
    const wrapper = mount(HighlightText, {
      props: { mode: 'plain', text: 'Wild pig; pig (domesticated)', needle: 'PIG' },
    })
    expect(wrapper.findAll('mark')).toHaveLength(2)
  })

  it('沒有要高亮的內容時原樣輸出', () => {
    const wrapper = mount(HighlightText, { props: { text: 'alaw' } })
    expect(wrapper.find('mark').exists()).toBe(false)
    expect(wrapper.text()).toBe('alaw')
  })
})
