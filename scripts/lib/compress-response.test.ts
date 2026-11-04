import { describe, expect, it } from 'vitest'

import { dynamicEncoding } from './compress-response.mjs'

const html = {
  contentType: 'text/html; charset=utf-8',
  contentEncoding: null,
  contentLength: null,
  acceptEncoding: 'gzip, deflate, br',
}

describe('dynamicEncoding', () => {
  it('compresses pages and API JSON with the best encoding accepted', () => {
    expect(dynamicEncoding(html)).toBe('br')
    expect(dynamicEncoding({ ...html, acceptEncoding: 'gzip' })).toBe('gzip')
    expect(
      dynamicEncoding({
        ...html,
        contentType: 'application/json; charset=utf-8',
      }),
    ).toBe('br')
  })

  it('never buffers a live event stream', () => {
    expect(
      dynamicEncoding({ ...html, contentType: 'text/event-stream' }),
    ).toBeNull()
  })

  it('leaves binary downloads, encoded bodies and small bodies alone', () => {
    expect(
      dynamicEncoding({ ...html, contentType: 'application/octet-stream' }),
    ).toBeNull()
    expect(dynamicEncoding({ ...html, contentType: 'image/png' })).toBeNull()
    expect(dynamicEncoding({ ...html, contentEncoding: 'gzip' })).toBeNull()
    expect(dynamicEncoding({ ...html, contentLength: '512' })).toBeNull()
  })

  it('sends the body as it is when the browser accepts no encoding', () => {
    expect(dynamicEncoding({ ...html, acceptEncoding: '' })).toBeNull()
    expect(dynamicEncoding({ ...html, acceptEncoding: 'identity' })).toBeNull()
  })
})
