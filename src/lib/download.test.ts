import { afterEach, describe, expect, it, vi } from 'vitest'

import { BLOB_URL_LIFETIME_MS, downloadTextFile } from './download'

describe('downloadTextFile', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('attaches the anchor, clicks it, removes it, and defers the revoke', () => {
    const createObjectURL = vi.fn(
      (_target: Blob | MediaSource) => 'blob:download',
    )

    const revokeObjectURL = vi.fn()
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)

    let attachedWhenClicked = false

    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        attachedWhenClicked = document.body.contains(this)
      })

    try {
      vi.useFakeTimers()
      downloadTextFile('report.csv', 'a,b\n1,2', 'text/csv')

      // A detached anchor is ignored by Firefox, so it has to be in the
      // document when clicked.
      expect(attachedWhenClicked).toBe(true)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0][0]
      expect(blob).toBeInstanceOf(Blob)

      if (!(blob instanceof Blob))
        throw new Error('no Blob reached the browser')
      expect(blob.type).toBe('text/csv')
      // The anchor does not linger in the document.
      expect(document.querySelectorAll('a[download]')).toHaveLength(0)
      // Revoking in the click's own tick drops the file in some browsers.
      expect(revokeObjectURL).not.toHaveBeenCalled()

      vi.advanceTimersByTime(BLOB_URL_LIFETIME_MS)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')
    } finally {
      anchorClick.mockRestore()
    }
  })

  it('hands a Blob through with its own type', () => {
    const createObjectURL = vi.fn((_target: Blob | MediaSource) => 'blob:given')
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)

    const blob = new Blob(['zip'], { type: 'application/zip' })
    downloadTextFile('package.zip', blob)
    expect(createObjectURL.mock.calls[0][0]).toBe(blob)
  })

  it('states a browser that cannot take a download', () => {
    const download = Object.getOwnPropertyDescriptor(
      HTMLAnchorElement.prototype,
      'download',
    )

    // Without the download attribute the click navigates to the blob instead
    // of saving it, so the helper has to say so rather than go quiet.
    Reflect.deleteProperty(HTMLAnchorElement.prototype, 'download')

    try {
      expect(() => downloadTextFile('report.csv', 'a,b')).toThrow(
        'This browser cannot save files.',
      )
    } finally {
      if (download) {
        Object.defineProperty(HTMLAnchorElement.prototype, 'download', download)
      }
    }
  })
})
