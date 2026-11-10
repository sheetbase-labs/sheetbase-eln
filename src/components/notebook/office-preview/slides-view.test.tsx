import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, Suspense } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import type { PreviewSlide } from '#/lib/office-preview/slides'
import { SlidesView } from './slides-view'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('owns image URLs only for committed slides and releases them on replacement and unmount', async () => {
  const live = new Set<string>()
  let nextId = 0

  class ObjectUrls extends URL {
    static override createObjectURL() {
      const url = `blob:slide-${++nextId}`
      live.add(url)

      return url
    }

    static override revokeObjectURL(url: string) {
      expect(live.delete(url)).toBe(true)
    }
  }

  vi.stubGlobal('URL', ObjectUrls)

  const slide = (number: number): PreviewSlide => ({
    number,
    title: `Plate ${number}`,
    lines: [],
    images: [{ data: new Uint8Array([number]), mediaType: 'image/png' }],
  })

  const slides = [slide(1), slide(2)]
  const pending = new Promise<never>(() => {})

  function Pending(): never {
    throw pending
  }

  const { container, rerender, unmount } = render(
    <Suspense fallback={<p>Loading</p>}>
      <SlidesView slides={slides} />
      <Pending />
    </Suspense>,
  )

  expect(screen.getByText('Loading')).toBeTruthy()
  expect(live.size).toBe(0)

  rerender(
    <StrictMode>
      <SlidesView slides={slides} />
    </StrictMode>,
  )
  const first = container.querySelector('img')?.getAttribute('src')
  expect(first).toBeDefined()
  expect(live).toEqual(new Set([first]))

  await userEvent.click(screen.getByRole('button', { name: 'Next slide' }))
  const second = container.querySelector('img')?.getAttribute('src')
  expect(second).toBeDefined()
  expect(second).not.toBe(first)
  expect(live).toEqual(new Set([second]))

  unmount()
  expect(live.size).toBe(0)
})

it('replaces positional picture resources correctly for repeated images, reorder and earlier removal', async () => {
  const live = new Map<string, Blob>()
  let nextId = 0

  class ObjectUrls extends URL {
    static override createObjectURL(blob: Blob) {
      const url = `blob:picture-${++nextId}`
      live.set(url, blob)

      return url
    }

    static override revokeObjectURL(url: string) {
      expect(live.delete(url)).toBe(true)
    }
  }

  vi.stubGlobal('URL', ObjectUrls)
  const first = { data: new Uint8Array([1, 9]), mediaType: 'image/png' }
  const second = { data: new Uint8Array([2, 3]), mediaType: 'image/png' }

  const slides = (images: PreviewSlide['images']): PreviewSlide[] => [
    { number: 1, title: 'Assay', lines: [], images },
  ]

  const { container, rerender, unmount } = render(
    <StrictMode>
      <SlidesView slides={slides([first, second, first])} />
    </StrictMode>,
  )

  const contents = () =>
    Promise.all(
      Array.from(container.querySelectorAll('img')).map((image) => {
        const blob = live.get(image.getAttribute('src') ?? '')

        if (!blob) throw new Error('Displayed image has no live Blob')

        return new Promise<number[]>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error)
          reader.onload = () => {
            if (!(reader.result instanceof ArrayBuffer)) {
              reject(new Error('FileReader did not return image bytes'))

              return
            }

            resolve(Array.from(new Uint8Array(reader.result)))
          }

          reader.readAsArrayBuffer(blob)
        })
      }),
    )

  expect(await contents()).toEqual([
    [1, 9],
    [2, 3],
    [1, 9],
  ])
  expect(live.size).toBe(3)

  rerender(
    <StrictMode>
      <SlidesView slides={slides([second, first, first])} />
    </StrictMode>,
  )
  expect(await contents()).toEqual([
    [2, 3],
    [1, 9],
    [1, 9],
  ])
  expect(live.size).toBe(3)

  rerender(
    <StrictMode>
      <SlidesView slides={slides([first, first])} />
    </StrictMode>,
  )
  expect(await contents()).toEqual([
    [1, 9],
    [1, 9],
  ])
  expect(live.size).toBe(2)
  unmount()
  expect(live.size).toBe(0)
})
