import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithRetry } from './fetch-retry.js'

describe('fetchWithRetry', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('網路錯誤與暫時的伺服器錯誤會重試，成功就回傳', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const res = await fetchWithRetry('/x', undefined, { retries: 2, delay: 1 })
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('404 這類永久錯誤不重試', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    expect((await fetchWithRetry('/x', undefined, { retries: 2, delay: 1 })).status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('重試用完仍然失敗時，交回最後的錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchWithRetry('/x', undefined, { retries: 1, delay: 1 })).rejects.toThrow('Failed to fetch')
  })
})
