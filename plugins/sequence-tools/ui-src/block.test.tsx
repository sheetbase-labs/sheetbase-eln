import { StrictMode } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { t } from './copy'
import { translateCds } from './lib/molbio'
import { sequenceOf } from './lib/sequence-block'
import type { SequenceBlockPayload } from './lib/sequence-block'
import type { BlockContext } from './lib/host'
import { CircularMap, LinearMap } from './sequence-map'
import { SequenceViewer } from './sequence-viewer'
import { Tabs } from './ui/kit'
import { PrimersTab } from './workbench/primers-tab'
import { CodonsTab } from './workbench/codons-tab'
import { CloningTab } from './workbench/cloning-tab'
import { DigestTab } from './workbench/digest-tab'
import { ReadsTab } from './workbench/reads-tab'
import { useBlockState } from './use-block-state'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('sequence block', () => {
  it('selects duplicate sequence names by occurrence', () => {
    const base = {
      name: 'same',
      description: '',
      organism: null,
      molecule: 'dna' as const,
      topology: 'linear' as const,
      features: [],
    }

    render(
      <SequenceViewer
        sequences={[
          { ...base, length: 4, residues: 'AAAA' },
          { ...base, length: 6, residues: 'CCCCCC' },
        ]}
      />,
    )
    const picker = screen.getByLabelText(t('sequences.viewer.record'))
    expect(screen.getAllByRole('option', { name: 'same' })).toHaveLength(2)
    fireEvent.change(picker, { target: { value: '1' } })
    expect(picker).toHaveProperty('value', '1')
    expect(screen.getByText(/6 bp/)).toBeTruthy()
  })

  it('selects a duplicate-size digest fragment by occurrence', () => {
    vi.stubGlobal('sheetbase', { host: vi.fn().mockResolvedValue([]) })
    const edit = vi.fn()

    const draft = sequenceOf({
      residues: 'GAATTCGAATTC',
      plans: [
        {
          id: 'plan',
          name: 'plan',
          method: 'ligation',
          enzymes: ['EcoRI'],
          parts: [
            {
              id: 'part',
              name: 'part',
              seq: 'GAATTCGAATTC',
              topology: 'circular',
              features: [],
            },
          ],
        },
      ],
    })

    let updated = draft
    edit.mockImplementation(
      (change: (value: SequenceBlockPayload) => SequenceBlockPayload) => {
        updated = change(updated)
      },
    )

    render(
      <CloningTab
        draft={draft}
        edit={edit}
        canEdit
        recordId=""
        blockId=""
        context={{}}
      />,
    )
    const picker = screen.getByLabelText(t('molbio.cloning.columns.use'))
    expect(picker.querySelectorAll('option')).toHaveLength(2)
    fireEvent.change(picker, { target: { value: '1' } })
    expect(updated.plans?.[0].partPick?.part).toEqual([1])
  })

  it('removes only the chosen occurrence of duplicate kept digests', () => {
    const edit = vi.fn()

    const draft = sequenceOf({
      residues: 'GAATTCGAATTC',
      digests: [
        { enzymes: ['EcoRI'], ladder: '1kb' },
        { enzymes: ['EcoRI'], ladder: '1kb' },
      ],
    })

    render(
      <DigestTab
        draft={draft}
        edit={edit}
        canEdit
        recordId=""
        blockId=""
        context={{}}
      />,
    )

    const buttons = screen.getAllByRole('button', {
      name: t('molbio.digest.removeKept'),
    })

    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    const updated = edit.mock.calls[0][0](draft)
    expect(updated.digests).toHaveLength(1)
    expect(updated.digests[0]).toBe(draft.digests?.[0])
  })

  it('keeps processing after a failed read and stops at the successful-read limit', async () => {
    const notify = vi.fn()
    vi.stubGlobal('sheetbase', { notify })
    const edit = vi.fn()

    const reads = Array.from({ length: 23 }, (_, i) => ({
      id: String(i),
      name: String(i),
      bases: 'ACGT',
      quality: 'IIII',
    }))

    const draft = sequenceOf({ residues: 'ACGT', reads })

    const { container } = render(
      <ReadsTab
        draft={draft}
        edit={edit}
        canEdit
        recordId=""
        blockId=""
        context={{}}
      />,
    )

    const bytes = new Uint8Array(156)
    const view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode('ABIF'), 0)
    view.setInt32(18, 1)
    view.setInt32(26, 128)
    bytes.set(new TextEncoder().encode('PBAS'), 128)
    view.setInt32(132, 2)
    view.setInt32(140, 4)
    view.setInt32(144, 4)
    bytes.set(new TextEncoder().encode('ACGT'), 148)
    const bad = new File(['bad'], 'bad.ab1')
    const good = new File([], 'good.ab1')
    const skipped = new File([], 'skipped.ab1')
    const readBad = vi.fn().mockResolvedValue(new Uint8Array(1).buffer)
    const readGood = vi.fn().mockResolvedValue(bytes.buffer)
    const readSkipped = vi.fn().mockResolvedValue(bytes.buffer)
    Object.defineProperty(bad, 'arrayBuffer', { value: readBad })
    Object.defineProperty(good, 'arrayBuffer', { value: readGood })
    Object.defineProperty(skipped, 'arrayBuffer', { value: readSkipped })
    const input = container.querySelector('input[type=file]')

    if (!input) throw new Error('read file input missing')
    fireEvent.change(input, { target: { files: [bad, good, skipped] } })
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1))
    expect(readBad).toHaveBeenCalledTimes(1)
    expect(readGood).toHaveBeenCalledTimes(1)
    expect(readSkipped).not.toHaveBeenCalled()
    expect(notify.mock.calls[0][0]).toContain('bad.ab1')
    expect(notify.mock.calls[1][0]).toBe(
      t('molbio.reads.tooMany', { count: 24 }),
    )
    expect(edit.mock.calls[0][0](draft).reads).toHaveLength(24)
  })

  it('looks up catalogue messages and falls back for unknown paths', () => {
    expect(t('molbio.block.primerCount', { count: 1 })).toBe('1 primer')
    expect(t('molbio.block.primerCount', { count: 2 })).toBe('2 primers')
    expect(t('molbio.block.missing')).toBe('molbio.block.missing')
    expect(t('molbio.block.empty.missing')).toBe('molbio.block.empty.missing')
  })

  it('reports malformed sibling data without offering it for cloning', async () => {
    const malformed = {
      name: 'unsafe',
      residues: 'ACGT',
      plans: [{ id: 'p', parts: 'not a list' }],
      metadata: { provenance: 'keep' },
    }

    const original = structuredClone(malformed)

    const host = vi.fn().mockResolvedValue([
      {
        id: 'sibling',
        type: 'plugin',
        payload: { plugin: 'sequence', block: 'sequence', state: malformed },
      },
    ])

    vi.stubGlobal('sheetbase', { host })
    const edit = vi.fn()

    const draft = sequenceOf({
      residues: 'ACGT',
      plans: [
        { id: 'plan', name: 'plan', method: 'gibson', enzymes: [], parts: [] },
      ],
    })

    render(
      <CloningTab
        draft={draft}
        edit={edit}
        canEdit
        recordId=""
        blockId="current"
        context={{ plugin: 'sequence', block: 'sequence', blockId: 'current' }}
      />,
    )
    fireEvent.change(screen.getByLabelText(t('molbio.cloning.add.label')), {
      target: { value: 'block' },
    })
    expect((await screen.findByRole('alert')).textContent).toContain(
      t('molbio.cloning.add.loadFailed'),
    )
    expect(screen.queryByText(t('molbio.cloning.add.noBlocks'))).toBeNull()
    expect(screen.queryByRole('option', { name: /unsafe/ })).toBeNull()
    expect(edit).not.toHaveBeenCalled()
    expect(malformed).toEqual(original)
  })

  it('offers valid sibling sequences as cloning parts', async () => {
    vi.stubGlobal('sheetbase', {
      host: vi.fn().mockResolvedValue([
        {
          id: 'sibling',
          type: 'plugin',
          payload: {
            plugin: 'sequence',
            block: 'sequence',
            state: { name: 'valid sibling', residues: 'GATTACA' },
          },
        },
      ]),
    })
    const edit = vi.fn()

    const draft = sequenceOf({
      residues: 'ACGT',
      plans: [
        { id: 'plan', name: 'plan', method: 'gibson', enzymes: [], parts: [] },
      ],
    })

    render(
      <CloningTab
        draft={draft}
        edit={edit}
        canEdit
        recordId=""
        blockId="current"
        context={{ plugin: 'sequence', block: 'sequence', blockId: 'current' }}
      />,
    )
    fireEvent.change(screen.getByLabelText(t('molbio.cloning.add.label')), {
      target: { value: 'block' },
    })
    await screen.findByRole('option', { name: 'valid sibling (7)' })
    fireEvent.change(screen.getByLabelText(t('molbio.cloning.add.block')), {
      target: { value: 'sibling' },
    })
    expect(edit).toHaveBeenCalledTimes(1)
    expect(edit.mock.calls[0][0](draft).plans[0].parts[0]).toMatchObject({
      name: 'valid sibling',
      seq: 'GATTACA',
      blockId: 'sibling',
    })
  })

  it('optimises the selected feature on the reverse strand', () => {
    const common = {
      type: 'CDS',
      start: 1,
      end: 6,
      parts: [{ start: 1, end: 6 }],
      qualifiers: {},
    }

    const draft = sequenceOf({
      residues: 'TTACAT',
      features: [
        { ...common, id: 1, label: 'forward', strand: 1 },
        { ...common, id: 2, label: 'reverse', strand: -1 },
      ],
    })

    const { container } = render(
      <CodonsTab
        draft={draft}
        edit={vi.fn()}
        canEdit
        recordId=""
        blockId=""
        context={{}}
      />,
    )

    fireEvent.change(screen.getByLabelText(t('molbio.codons.fromFeature')), {
      target: { value: '2' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: t('molbio.codons.run') }),
    )
    expect(
      translateCds(container.querySelector('pre')?.textContent ?? ''),
    ).toBe('M*')
  })

  it('blocks malformed saved data without modifying or saving it', () => {
    vi.useFakeTimers()

    let receive: (
      context: BlockContext,
      state: { name: string },
    ) => void = () => {}

    const setState = vi.fn()
    vi.stubGlobal('sheetbase', {
      onContext: (callback: typeof receive) => {
        receive = callback
      },
      setState,
    })

    const { result } = renderHook(() => useBlockState(), {
      wrapper: StrictMode,
    })

    const malformed = {
      name: 'original',
      plans: [
        {
          id: 'p',
          name: 'plan',
          method: 'gibson',
          enzymes: [],
          parts: 'not a list',
        },
      ],
      extra: { note: 'preserve' },
    }

    const original = structuredClone(malformed)

    act(() => {
      receive({}, { name: 'previous' })
      result.current.change((draft) => ({ ...draft, name: 'pending' }))
      receive({}, malformed)
      result.current.change((draft) => ({ ...draft, name: 'must not save' }))
      result.current.flush()
      window.dispatchEvent(new Event('pagehide'))
      vi.advanceTimersByTime(500)
    })
    expect(result.current.invalid).toBe(true)
    expect(setState).not.toHaveBeenCalled()
    expect(malformed).toEqual(original)
  })

  it('edits legacy defaults without losing unknown fields', () => {
    vi.useFakeTimers()

    let receive: (
      context: BlockContext,
      state: { name: string },
    ) => void = () => {}

    const setState = vi.fn()
    vi.stubGlobal('sheetbase', {
      onContext: (callback: typeof receive) => {
        receive = callback
      },
      setState,
    })

    const { result } = renderHook(() => useBlockState(), {
      wrapper: StrictMode,
    })

    const legacy = {
      name: 'legacy',
      extra: { provenance: 'keep' },
      primers: [{ id: 'p', name: 'primer', seq: 'ACGT', extra: 'keep too' }],
    }

    act(() => {
      receive({}, legacy)
      result.current.change((draft) => ({ ...draft, caption: 'edited' }))
      result.current.flush()
    })
    expect(result.current.invalid).toBe(false)
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({
        ...legacy,
        molecule: 'dna',
        topology: 'circular',
        residues: '',
        features: [],
        caption: 'edited',
      }),
    )
  })

  it('selects a tab using its declared key', () => {
    const select = vi.fn()
    render(
      <Tabs
        label="Sequence view"
        value="map"
        onValueChange={select}
        items={[
          { key: 'map', label: 'Map' },
          { key: 'edit', label: 'Edit' },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }))
    expect(select).toHaveBeenCalledWith('edit')
  })

  it.each(['circular', 'linear'] as const)(
    'clears the %s map selection with Escape',
    (topology) => {
      const select = vi.fn()

      const sequence = {
        name: 'Example',
        description: '',
        organism: null,
        molecule: 'dna' as const,
        topology,
        length: 12,
        residues: 'ACGTACGTACGT',
        features: [
          {
            id: 1,
            type: 'CDS',
            label: 'Feature',
            strand: 1 as const,
            start: 1,
            end: 6,
            parts: [{ start: 1, end: 6 }],
            qualifiers: {},
          },
        ],
      }

      const props = { sequence, selectedId: 1, onSelect: select }
      render(
        topology === 'circular' ? (
          <CircularMap {...props} />
        ) : (
          <LinearMap {...props} from={1} to={12} />
        ),
      )
      fireEvent.keyDown(screen.getByRole('button', { name: /Feature/ }), {
        key: 'Escape',
      })
      expect(select).toHaveBeenCalledWith(null)
    },
  )

  it('keeps hook order across empty, DNA and protein transitions', () => {
    const draft = sequenceOf({})

    const props = {
      draft,
      edit: vi.fn(),
      canEdit: true,
      recordId: '',
      blockId: '',
      context: {},
    }

    const view = render(<PrimersTab {...props} />)
    expect(screen.getByText(t('molbio.enzymes.empty'))).toBeTruthy()

    view.rerender(
      <PrimersTab {...props} draft={{ ...draft, residues: 'ACGTACGTACGT' }} />,
    )
    expect(
      screen.getByRole('button', { name: t('molbio.primers.run') }),
    ).toBeTruthy()

    view.rerender(
      <PrimersTab
        {...props}
        draft={{ ...draft, molecule: 'protein', residues: 'MKT' }}
      />,
    )
    expect(screen.getByText(t('molbio.enzymes.dnaOnly'))).toBeTruthy()

    view.rerender(<PrimersTab {...props} />)
    expect(screen.getByText(t('molbio.enzymes.empty'))).toBeTruthy()
  })

  it('coalesces rapid edits and flushes the latest state on pagehide or demand', () => {
    vi.useFakeTimers()

    let receive: (
      context: BlockContext,
      state: SequenceBlockPayload,
    ) => void = () => {}

    const setState = vi.fn()
    vi.stubGlobal('sheetbase', {
      onContext: (callback: typeof receive) => {
        receive = callback
      },
      setState,
    })

    const { result } = renderHook(() => useBlockState(), {
      wrapper: StrictMode,
    })

    act(() => receive({}, sequenceOf({ name: 'original' })))
    act(() => {
      result.current.change((draft) => ({
        ...draft,
        name: `${draft.name} one`,
      }))
      result.current.change((draft) => ({
        ...draft,
        name: `${draft.name} two`,
      }))
    })
    expect(result.current.draft.name).toBe('original one two')
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(setState).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(setState).toHaveBeenCalledTimes(1)
    expect(setState.mock.calls[0][0].name).toBe('original one two')

    act(() => {
      result.current.change((draft) => ({ ...draft, caption: 'first' }))
      vi.advanceTimersByTime(400)
      result.current.change((draft) => ({ ...draft, caption: 'second' }))
      vi.advanceTimersByTime(499)
    })
    expect(setState).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(setState).toHaveBeenCalledTimes(2)
    expect(setState.mock.calls[1][0].caption).toBe('second')

    act(() => {
      result.current.change((draft) => ({ ...draft, caption: 'latest' }))
      receive({}, sequenceOf({ name: 'stale' }))
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(setState).toHaveBeenCalledTimes(3)
    expect(setState.mock.calls[2][0]).toMatchObject({
      name: 'original one two',
      caption: 'latest',
    })
    act(() => {
      result.current.change((draft) => ({ ...draft, caption: 'flushed' }))
      result.current.flush()
      vi.advanceTimersByTime(500)
    })
    expect(setState).toHaveBeenCalledTimes(4)
    expect(setState.mock.calls[3][0].caption).toBe('flushed')
  })
})
