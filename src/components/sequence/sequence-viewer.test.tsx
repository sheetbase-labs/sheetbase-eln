import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { parseGenBank } from '#/lib/sequence'
import { SequenceViewer } from './sequence-viewer'

const GENBANK = `LOCUS       pTest                     60 bp    DNA     circular SYN 01-JAN-2026
DEFINITION  Test plasmid.
FEATURES             Location/Qualifiers
     promoter        1..10
                     /label=T7 promoter
     CDS             11..22
                     /label=GFP
                     /note="reporter"
ORIGIN
        1 taatacgact atggtgagca aggagctgtt caccggcgtg gtgcccatcc tggtcgagct
//
`

afterEach(cleanup)

describe('SequenceViewer', () => {
  it('opens a circular plasmid as a map with its features listed', () => {
    render(<SequenceViewer sequences={parseGenBank(GENBANK)} />)
    expect(screen.getByText(/DNA · circular · 60 bp/)).toBeTruthy()
    expect(
      screen.getByRole('group', { name: /pTest, 60 bp, circular/ }),
    ).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'T7 promoter' })).toBeTruthy()
  })

  it('shows a feature’s details and its translation when selected', async () => {
    render(<SequenceViewer sequences={parseGenBank(GENBANK)} />)
    await userEvent.click(screen.getByRole('button', { name: 'GFP' }))
    expect(
      screen.getByRole('region', { name: 'Selected feature' }),
    ).toBeTruthy()
    expect(screen.getByText('reporter')).toBeTruthy()
    expect(screen.getByText('MVSK')).toBeTruthy()
  })

  it('switches to the linear view and lays out the bases', async () => {
    render(<SequenceViewer sequences={parseGenBank(GENBANK)} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Linear' }))
    expect(screen.getByText('Bases')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy()
  })
})
