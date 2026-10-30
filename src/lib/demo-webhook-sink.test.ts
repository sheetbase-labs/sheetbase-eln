import { describe, expect, it } from 'vitest'

import {
  demoWebhookSinkResponse,
  demoWebhookSinkUrl,
} from './demo-webhook-sink'

const post = () =>
  new Request('https://demo.test/api/demo/webhook-sink', { method: 'POST' })

describe('demo webhook sink', () => {
  it('accepts a delivery in the demo', async () => {
    const response = demoWebhookSinkResponse(post(), true)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, demo: true })
  })

  it('does not exist anywhere else', () => {
    expect(demoWebhookSinkResponse(post(), false).status).toBe(404)
  })

  it('only takes POST', () => {
    const get = new Request('https://demo.test/api/demo/webhook-sink')
    expect(demoWebhookSinkResponse(get, true).status).toBe(405)
  })

  it('is addressed on the deployment, and only where the delivery engine may call it', () => {
    expect(demoWebhookSinkUrl('https://app.example.com/')).toBe(
      'https://app.example.com/api/demo/webhook-sink',
    )
    expect(demoWebhookSinkUrl('http://localhost:3000')).toBeNull()
    expect(demoWebhookSinkUrl('https://localhost')).toBeNull()
    expect(demoWebhookSinkUrl(undefined)).toBeNull()
  })
})
