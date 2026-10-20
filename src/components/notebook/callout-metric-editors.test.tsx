/**
 * A4: the callout and metric editors.
 *
 * Both block kinds were stored, validated and rendered but had no editor, so
 * selecting one showed an unsupported-block placeholder and the content could
 * not be changed. These tests pin the behaviour that closed that gap: the
 * stored values load into the editor, and an edit saves a payload the boundary
 * validator accepts.
 *
 * Saves are driven through blur, which flushes the 800 ms autosave debounce
 * synchronously. Assertions read the saved payload field by field: the whole
 * object also carries keys the editor deliberately leaves `undefined`, and
 * asserting on those would test the key set rather than the content.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { BlockEditor } from './block-editor'
import type * as notebookDataModule from '#/lib/notebook-data'
import type { NotebookBlock } from '#/lib/notebook-data'

vi.mock('#/lib/notebook-data', async (importOriginal) => {
  const actual = await importOriginal<typeof notebookDataModule>()
  return {
    ...actual,
    notebookDataClient: {
      ...actual.notebookDataClient,
      list: vi.fn().mockResolvedValue([]),
    },
  }
})

vi.mock('#/lib/dataset-explorer-data', () => ({
  fetchDatasetSummaries: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children?: ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => cleanup())

function block(
  overrides: Partial<NotebookBlock> & { type: NotebookBlock['type'] },
): NotebookBlock {
  return {
    id: 'b1',
    recordId: 'r1',
    payload: {},
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
    ...overrides,
  }
}

/** The payload from the only save, or a failure if nothing was saved. */
function savedPayload(save: Mock) {
  expect(save).toHaveBeenCalledTimes(1)
  return save.mock.calls[0][0] as Record<string, unknown>
}

describe('BlockEditor — callout', () => {
  it('loads the stored text and saves the edited text with its tone', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'callout',
          payload: { text: 'Read the SDS first.', variant: 'warning' },
        })}
        save={save}
      />,
    )

    const text = screen.getByLabelText('Callout text')
    expect((text as HTMLTextAreaElement).value).toBe('Read the SDS first.')

    await user.clear(text)
    await user.type(text, 'Do not exceed 40 °C.')
    await user.tab()

    expect(savedPayload(save)).toEqual({
      text: 'Do not exceed 40 °C.',
      variant: 'warning',
    })
  })

  it('names a payload with no tone as the information tone', () => {
    renderWithQuery(
      <BlockEditor
        block={block({ type: 'callout', payload: { text: 'Legacy row.' } })}
        save={vi.fn(async () => ({ ok: true }))}
      />,
    )
    expect(screen.getByLabelText('Callout tone').textContent).toContain(
      'Information',
    )
  })

  it('offers exactly the contract’s four tones', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <BlockEditor
        block={block({ type: 'callout', payload: { text: 'Note.' } })}
        save={vi.fn(async () => ({ ok: true }))}
      />,
    )
    await user.click(screen.getByLabelText('Callout tone'))
    // The boundary validator accepts info, warning, note and danger, and
    // nothing else.
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent.trim())).toEqual([
      'Information',
      'Warning',
      'Note',
      'Danger',
    ])
  })

  it('saves the tone the author picks', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
      <BlockEditor
        block={block({ type: 'callout', payload: { text: 'Legacy row.' } })}
        save={save}
      />,
    )
    await user.click(screen.getByLabelText('Callout tone'))
    await user.click(await screen.findByRole('menuitem', { name: 'Danger' }))
    // Blur flushes the debounce, as it does for a typed edit.
    await user.click(screen.getByLabelText('Callout text'))
    await user.tab()
    expect(savedPayload(save)).toEqual({
      text: 'Legacy row.',
      variant: 'danger',
    })
  })
})

describe('BlockEditor — metric', () => {
  it('keeps a numeric reading numeric, so number formatting still applies', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'metric',
          payload: { label: 'Yield', value: 82.5, unit: '%' },
        })}
        save={save}
      />,
    )

    expect(screen.getByLabelText<HTMLInputElement>('Metric value').value).toBe(
      '82.5',
    )
    await user.clear(screen.getByLabelText('Metric value'))
    await user.type(screen.getByLabelText('Metric value'), '91.25')
    await user.tab()

    expect(savedPayload(save)).toEqual({
      label: 'Yield',
      value: 91.25,
      unit: '%',
    })
  })

  it('keeps a non-numeric reading as text rather than coercing it', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'metric',
          payload: { label: 'Verdict', value: '' },
        })}
        save={save}
      />,
    )
    await user.type(screen.getByLabelText('Metric value'), 'not detected')
    await user.tab()
    expect(savedPayload(save).value).toBe('not detected')
  })

  it('omits a cleared unit rather than saving an empty string', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'metric',
          payload: { label: 'Yield', value: 82.5, unit: '%' },
        })}
        save={save}
      />,
    )
    await user.clear(screen.getByLabelText('Metric unit'))
    await user.tab()
    const saved = savedPayload(save)
    expect(saved.value).toBe(82.5)
    // Present-but-blank and absent are different payloads; the validator
    // accepts either, and the preview would otherwise render a bare unit gap.
    expect('unit' in saved ? saved.unit : undefined).toBeUndefined()
  })
})

describe('BlockEditor — conclusion', () => {
  it('loads the stored conclusion and saves an edited verdict and basis', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'conclusion',
          payload: { text: 'Titre fell.', verdict: 'supported', basis: '' },
        })}
        save={save}
      />,
    )

    const text = screen.getByLabelText('Conclusion text')
    expect((text as HTMLTextAreaElement).value).toBe('Titre fell.')

    await user.selectOptions(screen.getByLabelText('Verdict'), 'not_supported')
    await user.type(screen.getByLabelText('Based on'), 'ELISA, n = 12')
    await user.tab()

    const payload = savedPayload(save)
    expect(payload.text).toBe('Titre fell.')
    expect(payload.verdict).toBe('not_supported')
    expect(payload.basis).toBe('ELISA, n = 12')
  })
})
