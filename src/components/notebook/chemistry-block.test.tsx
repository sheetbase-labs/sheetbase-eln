/**
 * Chemistry blocks: the read view shows the drawing and the worked-out table,
 * and the editor saves a payload the boundary validator accepts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockEditor } from './block-editor'
import { BlockPreview } from './block-preview'
import { ReactionTable } from './chemistry-block'
import type { ReactionPayload } from '#/lib/chemistry'
import { loadOcl } from '#/lib/chemistry-draw'
import type { NotebookBlock } from '#/lib/notebook-data'

afterEach(() => cleanup())

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

function block(
  type: 'structure' | 'reaction',
  payload: NotebookBlock['payload'],
): NotebookBlock {
  return {
    id: 'b1',
    recordId: 'r1',
    type,
    payload,
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

const aspirinMolfile = async () => {
  const ocl = await loadOcl()
  const molecule = ocl.Molecule.fromSmiles('CC(=O)Oc1ccccc1C(=O)O')
  molecule.inventCoordinates()

  return molecule.toMolfile()
}

const reaction = {
  title: 'Aspirin',
  drawing: '',
  rows: [
    {
      id: 'sal',
      role: 'reactant',
      name: 'Salicylic acid',
      formula: 'C7H6O3',
      mw: 138.12,
      massMg: 1000,
    },
    {
      id: 'anh',
      role: 'reactant',
      name: 'Acetic anhydride',
      mw: 102.09,
      equiv: 1.5,
    },
    { id: 'asa', role: 'product', name: 'Aspirin', mw: 180.16, massMg: 900 },
  ],
} satisfies ReactionPayload

describe('structure block', () => {
  it('draws the molecule and says what it is', async () => {
    wrap(
      <BlockPreview
        block={block('structure', {
          title: 'Aspirin',
          molfile: await aspirinMolfile(),
          formula: 'C9H8O4',
          mw: 180.159,
          smiles: 'CC(=O)Oc1ccccc1C(=O)O',
          caption: 'The target.',
        })}
      />,
    )
    expect(await screen.findByRole('img', { name: /Aspirin/ })).toBeTruthy()
    expect(screen.getByText(/C9H8O4/)).toBeTruthy()
    expect(screen.getByText(/180\.2 g\/mol/)).toBeTruthy()
    expect(screen.getByText('The target.')).toBeTruthy()
  })

  it('says nothing is drawn for a new block', () => {
    wrap(<BlockPreview block={block('structure', { molfile: '' })} />)
    expect(screen.getByText('Nothing drawn yet')).toBeTruthy()
  })

  it('saves the title and name an editor types, keeping the drawing', async () => {
    const user = userEvent.setup()

    const save = vi.fn(async (_payload: NotebookBlock['payload']) => ({
      ok: true,
    }))

    const molfile = await aspirinMolfile()
    wrap(
      <BlockEditor
        block={block('structure', { molfile, formula: 'C9H8O4' })}
        save={save}
      />,
    )
    await user.type(screen.getByLabelText('Title'), 'Target')
    await user.type(screen.getByLabelText('Compound name'), 'Aspirin')
    await user.tab()
    expect(save).toHaveBeenCalled()
    const saved = save.mock.calls.at(-1)![0]
    expect(saved).toMatchObject({
      title: 'Target',
      name: 'Aspirin',
      molfile,
      formula: 'C9H8O4',
    })
  })
})

describe('reaction block', () => {
  it('shows the table with what was worked out', () => {
    wrap(<BlockPreview block={block('reaction', reaction)} />)
    const table = screen.getByRole('table', { name: 'Reaction table' })
    const anhydride = within(table).getByText('Acetic anhydride').closest('tr')!
    // 1.5 equivalents of 7.24 mmol: 10.86 mmol and 1,109 mg.
    expect(within(anhydride).getByText('10.86')).toBeTruthy()
    expect(within(anhydride).getByText('1,109')).toBeTruthy()
    // 900 mg isolated of 1,304 mg possible.
    expect(within(table).getByText('69%')).toBeTruthy()
    expect(within(table).getByText('1,304')).toBeTruthy()
  })

  it('marks the limiting reactant', () => {
    wrap(<BlockPreview block={block('reaction', reaction)} />)

    const sal = within(screen.getByRole('table', { name: 'Reaction table' }))
      .getByText('Salicylic acid')
      .closest('tr')!

    expect(within(sal).getByText(/Limiting/)).toBeTruthy()
  })

  it('lets an amount replace equivalents in the editor', async () => {
    const user = userEvent.setup()

    const save = vi.fn(async (_payload: NotebookBlock['payload']) => ({
      ok: true,
    }))

    wrap(<BlockEditor block={block('reaction', reaction)} save={save} />)
    const mass = screen.getByLabelText('Mass (mg): Acetic anhydride')
    await user.type(mass, '1500')
    await user.click(screen.getByLabelText('Title'))
    await user.tab()

    const saved = save.mock.lastCall?.[0]
    expect(saved).toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({ id: 'anh', massMg: 1500 }),
      ]),
    })
    expect(saved).toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({ id: 'anh', equiv: null }),
      ]),
    })
  })

  it('adds a row for something that was not drawn', async () => {
    const user = userEvent.setup()

    const save = vi.fn(async (_payload: NotebookBlock['payload']) => ({
      ok: true,
    }))

    wrap(<BlockEditor block={block('reaction', reaction)} save={save} />)
    await user.click(screen.getByRole('button', { name: 'Add row' }))
    await user.click(screen.getByLabelText('Title'))
    await user.tab()

    const saved = save.mock.lastCall?.[0]
    expect(saved?.rows).toHaveLength(4)
    expect(saved).toMatchObject({
      rows: [
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { role: 'solvent' },
      ],
    })
  })

  it('updates calculated cells without remounting or blurring the active amount', async () => {
    const user = userEvent.setup()
    const edit = { update: vi.fn(), remove: vi.fn(), setLimiting: vi.fn() }
    const { rerender } = wrap(<ReactionTable payload={reaction} edit={edit} />)
    const mass = screen.getByLabelText('Mass (mg): Salicylic acid')
    await user.click(mass)

    rerender(
      <ReactionTable
        payload={{
          ...reaction,
          rows: reaction.rows.map((row) =>
            row.id === 'sal' ? { ...row, massMg: 2000 } : row,
          ),
        }}
        edit={edit}
      />,
    )

    expect(screen.getByLabelText('Mass (mg): Salicylic acid')).toBe(mass)
    expect(document.activeElement).toBe(mass)
    expect(screen.getByText('2,609')).toBeTruthy()
    expect(screen.getByText('34.5%')).toBeTruthy()
  })
})
