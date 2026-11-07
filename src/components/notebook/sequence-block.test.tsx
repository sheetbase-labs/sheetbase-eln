/**
 * Sequence blocks: the read view shows the map and a summary, the editor takes
 * pasted bases and saves a payload the boundary validator accepts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockEditor } from './block-editor'
import { BlockPreview } from './block-preview'
import { validateBlock as validate } from '#/lib/blocks'
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children?: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

afterEach(() => cleanup())

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function block(payload: Record<string, unknown>): NotebookBlock {
  return {
    id: 'b1',
    recordId: 'r1',
    type: 'sequence',
    payload,
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

const residues =
  'GAATTCGCTAGCAAGCTTGGATCCGTCGACCTGCAGGCATGCAAGCTTGGCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCG'

const plasmid = {
  name: 'pTest',
  title: 'Backbone',
  molecule: 'dna',
  topology: 'circular',
  residues,
  features: [],
  caption: 'The backbone.',
}

describe('sequence block', () => {
  it('reads as a summary with the caption', () => {
    wrap(<BlockPreview block={block(plasmid)} />)
    expect(screen.getAllByText(/pTest/).length).toBeGreaterThan(0)
    expect(screen.getByText(/circular/)).toBeTruthy()
    expect(screen.getByText('The backbone.')).toBeTruthy()
  })

  it('says no sequence has been added to a new block', () => {
    wrap(<BlockPreview block={block({})} />)
    expect(screen.getByText(/No sequence has been added/)).toBeTruthy()
  })

  it('opens the tools from the read view', async () => {
    const user = userEvent.setup()
    wrap(<BlockPreview block={block(plasmid)} />)
    await user.click(screen.getByRole('button', { name: 'Open the tools' }))
    expect(await screen.findByRole('tab', { name: 'Digest' })).toBeTruthy()
  })

  it('saves bases typed into a new block, and the payload is valid', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async (_payload: Record<string, unknown>) => ({
      ok: true,
    }))
    wrap(<BlockEditor block={block({})} save={save} />)
    await user.type(screen.getByLabelText('Sequence name'), 'pTest')
    await user.click(screen.getByLabelText('Sequence to paste'))
    await user.paste(residues)
    await user.click(screen.getByRole('button', { name: 'Use this sequence' }))
    await user.tab()
    await vi.waitFor(
      () => {
        const last = save.mock.calls.at(-1)?.[0]
        expect(last?.residues).toBe(residues)
      },
      { timeout: 4000 },
    )
    const saved = save.mock.calls.at(-1)![0]
    expect(saved).toMatchObject({ name: 'pTest', residues })
    expect(validateBlock('sequence', saved)).toMatchObject({ ok: true })
  })
})

const validateBlock = (type: string, payload: unknown) =>
  validate({ type, payload })

describe('sequence block validation', () => {
  it('accepts a plasmid and refuses letters that are not bases', () => {
    expect(validateBlock('sequence', plasmid)).toMatchObject({ ok: true })
    expect(
      validateBlock('sequence', { ...plasmid, residues: 'GAAT123!' }),
    ).toMatchObject({ ok: false })
    expect(
      validateBlock('sequence', { ...plasmid, molecule: 'carbohydrate' }),
    ).toMatchObject({ ok: false })
  })
})
