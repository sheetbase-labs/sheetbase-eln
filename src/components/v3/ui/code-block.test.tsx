import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodeBlock, codeText } from './code-block'

/**
 * The code block treats its payload as text: it is never executed or
 * interpreted, content that is not valid UTF-16 renders as visibly broken text
 * rather than throwing, and the payload can be copied out — which is what the
 * JSON dumps are for.
 */

const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: sonner.toast,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sonner.toast.mockClear()
  sonner.toast.error.mockClear()
})

describe('codeText', () => {
  it('passes ordinary SQL through unchanged', () => {
    expect(codeText('select * from input where n > 1')).toBe(
      'select * from input where n > 1',
    )
  })

  it('keeps astral characters but replaces lone surrogates and NUL', () => {
    expect(codeText('a\ud800b')).toBe('a\uFFFDb')
    expect(codeText('a\u0000b')).toBe('a\uFFFDb')
    expect(codeText('a\ud83d\ude00b')).toBe('a\ud83d\ude00b')
  })
})

describe('CodeBlock', () => {
  it('renders the statement as text without executing or interpreting it', () => {
    const { container } = render(
      <CodeBlock
        code={"select '<script>alert(1)</script>' as {notJsx}"}
        language="sql"
        label="Transform statement"
      />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe(
      "select '<script>alert(1)</script>' as {notJsx}",
    )
    expect(
      screen.getByText("select '<script>alert(1)</script>' as {notJsx}"),
    ).toBeTruthy()
  })

  it('names the language and omits the chip when the config does not say', () => {
    const { container, rerender } = render(
      <CodeBlock code="select 1" language="sql" label="Transform statement" />,
    )
    expect(
      container.querySelector('[data-slot="code-language"]')?.textContent,
    ).toBe('sql')

    rerender(<CodeBlock code="select 1" label="Transform statement" />)
    expect(container.querySelector('[data-slot="code-language"]')).toBeNull()
  })

  it('states an empty statement instead of rendering an empty box', () => {
    const { container } = render(
      <CodeBlock code="" language="sql" label="Transform statement" />,
    )

    expect(
      container.querySelector('[data-slot="code-block-empty"]')?.textContent,
    ).toBe('Empty statement.')
    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('code')).toBeNull()
  })

  it('treats whitespace-only content as empty', () => {
    const { container } = render(
      <CodeBlock code={'  \n\t '} label="Transform statement" />,
    )

    expect(
      container.querySelector('[data-slot="code-block-empty"]'),
    ).not.toBeNull()
    expect(container.querySelector('pre')).toBeNull()
  })

  it('keeps a long single-line statement whole in a scrollable region', () => {
    const long = `select '${'x'.repeat(4000)}' as wide`
    const { container } = render(
      <CodeBlock code={long} language="sql" label="Transform statement" />,
    )

    const pre = container.querySelector('pre')
    expect(pre?.textContent).toHaveLength(long.length)
    expect(pre?.className).toContain('overflow-auto')
    expect(pre?.getAttribute('tabindex')).toBe('0')
  })

  it('renders non-UTF-16-safe content as text with replacement characters', () => {
    const { container } = render(
      <CodeBlock
        code={'select \ud800 from input\u0000'}
        language="sql"
        label="Transform statement"
      />,
    )

    expect(container.querySelector('code')?.textContent).toBe(
      'select \uFFFD from input\uFFFD',
    )
  })

  it('bounds the payload when the caller asks for a bound', () => {
    const { container, rerender } = render(
      <CodeBlock code="select 1" label="Payload" maxHeight="sm" />,
    )
    expect(container.querySelector('pre')?.className).toContain('max-h-40')

    rerender(<CodeBlock code="select 1" label="Payload" maxHeight="lg" />)
    expect(container.querySelector('pre')?.className).toContain('max-h-60')

    rerender(<CodeBlock code="select 1" label="Payload" />)
    expect(container.querySelector('pre')?.className).not.toContain('max-h-')
  })

  it('puts the payload on the clipboard and confirms it', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    render(
      <CodeBlock
        code={'{"rowCount": 12}'}
        language="json"
        label="Technical result payload"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('{"rowCount": 12}')
    expect(sonner.toast).toHaveBeenCalledWith('Copied')
    expect(sonner.toast.error).not.toHaveBeenCalled()
  })

  it('says the copy failed instead of claiming one, and offers no copy for nothing', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    )
    const { rerender } = render(<CodeBlock code="select 1" label="Payload" />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(sonner.toast.error).toHaveBeenCalled()
    expect(sonner.toast).not.toHaveBeenCalled()

    // An empty payload has nothing to hand over.
    rerender(<CodeBlock code="   " label="Payload" />)
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })
})
