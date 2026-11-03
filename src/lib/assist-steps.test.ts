import { describe, expect, it } from 'vitest'

import { MAX_DRAFT_STEPS, buildStepsText, parseSteps } from './assist-steps'

describe('parseSteps', () => {
  it('strips numbering, bullets and blank lines', () => {
    expect(
      parseSteps(
        '1. Thaw the vial\n2) Spin at 300 g\n- Resuspend\n\nStep 4: Count',
      ),
    ).toEqual(['Thaw the vial', 'Spin at 300 g', 'Resuspend', 'Count'])
  })
  it('caps the list', () => {
    const many = Array.from({ length: 80 }, (_, i) => `Do ${i}`).join('\n')
    expect(parseSteps(many)).toHaveLength(MAX_DRAFT_STEPS)
  })
})

describe('buildStepsText', () => {
  it('leaves out empty notes', () => {
    expect(buildStepsText(' Plate assay ', '')).toBe('Protocol: Plate assay')
    expect(buildStepsText('Plate assay', 'use 96 wells')).toContain('Notes:')
  })
})
