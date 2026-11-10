import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileUpload } from './use-file-upload'
import type { FileWithPreview } from './use-file-upload'

/**
 * The hook's own contract, as `src/components/ui/file-drop.tsx` consumes it:
 * every change to the selection is reported to the caller exactly once, with the
 * selection that resulted, and the object URLs the hook mints are released when
 * their entry goes.
 *
 * The first test is the regression: the callback used to be invoked from inside
 * a React state updater, which StrictMode runs twice, so one pick reported twice.
 *
 * Local suite, not a registry file: `use-file-upload` itself is copy-and-own
 * source (ADR-0055), and these tests are ours. Strict-lint pass, 2026-11-10
 * (ADR-0057): `setup` keeps its inferred return type instead of an anonymous
 * one, and the removal test reads `files().at(0)` and fails loudly when there is
 * no entry, instead of guarding a value the array type called non-null.
 */

afterEach(cleanup)

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let originalCreate: PropertyDescriptor | undefined
let originalRevoke: PropertyDescriptor | undefined

/** jsdom implements neither, so the hook's previews need both supplied. */
beforeEach(() => {
  originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

  const urls = new WeakMap<Blob, string>()
  let minted = 0
  createObjectURL = vi.fn((blob: Blob) => {
    const existing = urls.get(blob)

    if (existing !== undefined) return existing

    minted += 1
    const url = `blob:preview-${minted}`
    urls.set(blob, url)

    return url
  })
  revokeObjectURL = vi.fn()

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  })
})

afterEach(() => {
  if (originalCreate) {
    Object.defineProperty(URL, 'createObjectURL', originalCreate)
  } else {
    Reflect.deleteProperty(URL, 'createObjectURL')
  }

  if (originalRevoke) {
    Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
  } else {
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  }
})

function csv(name: string): File {
  return new File(['sample,value\nA,1.2\n'], name, { type: 'text/csv' })
}

/** Render the hook inside StrictMode, so a doubled updater would show. */
function setup(options: Partial<Parameters<typeof useFileUpload>[0]> = {}) {
  const onFilesChange = vi.fn()

  const { result } = renderHook(
    () => useFileUpload({ multiple: true, ...options, onFilesChange }),
    {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    },
  )

  return {
    files: () => result.current[0].files,
    actions: () => result.current[1],
    onFilesChange,
  }
}

describe('useFileUpload', () => {
  it('reports one pick once, even where StrictMode runs the updater twice', () => {
    const { actions, files, onFilesChange } = setup()

    act(() => {
      actions().addFiles([csv('plate-01.csv')])
    })

    expect(files().map((entry) => entry.file.name)).toEqual(['plate-01.csv'])
    expect(onFilesChange).toHaveBeenCalledTimes(1)
    expect(
      onFilesChange.mock.calls[0]?.[0].map(
        (entry: FileWithPreview) => entry.file.name,
      ),
    ).toEqual(['plate-01.csv'])
  })

  it('reports the remaining selection when a file is removed, and releases its preview', () => {
    const { actions, files, onFilesChange } = setup()

    act(() => {
      actions().addFiles([csv('plate-01.csv'), csv('plate-02.csv')])
    })

    const removed = files().at(0)

    if (!removed) throw new Error('the hook kept no files after two were added')

    expect(removed.preview).toBeTruthy()

    act(() => {
      actions().removeFile(removed.id)
    })

    expect(files().map((entry) => entry.file.name)).toEqual(['plate-02.csv'])
    expect(onFilesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        file: expect.objectContaining({ name: 'plate-02.csv' }),
      }),
    ])
    expect(revokeObjectURL).toHaveBeenCalledWith(removed.preview)
  })

  it('reports an empty selection when cleared, and releases every preview', () => {
    const { actions, files, onFilesChange } = setup()

    act(() => {
      actions().addFiles([csv('plate-01.csv'), csv('plate-02.csv')])
    })

    const previews = files().map((entry) => entry.preview)

    act(() => {
      actions().clearFiles()
    })

    expect(files()).toEqual([])
    expect(onFilesChange).toHaveBeenLastCalledWith([])
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(previews)
  })

  it('releases previews it created when the hook unmounts', () => {
    const onFilesChange = vi.fn()

    const { result, unmount } = renderHook(
      () => useFileUpload({ multiple: true, onFilesChange }),
      {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      },
    )

    act(() => {
      result.current[1].addFiles([csv('plate-01.csv')])
    })

    const preview = result.current[0].files[0]?.preview
    expect(preview).toBeTruthy()

    unmount()

    expect(revokeObjectURL).toHaveBeenCalledWith(preview)
    // The caller hears about adds, not about the hook going away.
    expect(onFilesChange).toHaveBeenCalledTimes(1)
  })

  it('replaces the selection in single-file mode, clearing before each pick', () => {
    const { actions, files, onFilesChange } = setup({ multiple: false })

    act(() => {
      actions().addFiles([csv('plate-01.csv')])
    })
    act(() => {
      actions().addFiles([csv('plate-02.csv')])
    })

    expect(files().map((entry) => entry.file.name)).toEqual(['plate-02.csv'])
    // The registry form's own order, once per call: an empty clear before each
    // pick, then the selection itself.
    expect(onFilesChange.mock.calls.map(([entries]) => entries.length)).toEqual(
      [0, 1, 0, 1],
    )
  })
})
