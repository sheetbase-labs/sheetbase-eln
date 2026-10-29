import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ProtocolDocument } from './protocol-document'

afterEach(cleanup)

describe('ProtocolDocument', () => {
  it('preserves ordered lists, scientific marks, units and tolerance rather than flattening text', () => {
    const { container } = render(
      <ProtocolDocument
        blocks={[
          {
            id: 'purpose',
            type: 'rich_text',
            payload: {
              doc: {
                type: 'doc',
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Parameters' }],
                  },
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: '100 LMH ±5; 50 L/m' },
                      {
                        type: 'text',
                        text: '2',
                        marks: [{ type: 'superscript' }],
                      },
                      { type: 'text', text: '; hold 2–8 °C ≤14 days.' },
                    ],
                  },
                  {
                    type: 'orderedList',
                    attrs: { start: 3 },
                    content: [
                      {
                        type: 'listItem',
                        content: [
                          {
                            type: 'paragraph',
                            content: [
                              {
                                type: 'text',
                                text: 'Record pressure every 10 L/m².',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ]}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Parameters', level: 2 }),
    ).toBeTruthy()
    expect(container.querySelector('sup')?.textContent).toBe('2')
    expect(container.querySelector('ol')?.start).toBe(3)
    expect(screen.getByRole('listitem').textContent).toBe(
      'Record pressure every 10 L/m².',
    )
    expect(screen.getByRole('article').textContent).toContain(
      '100 LMH ±5; 50 L/m2; hold 2–8 °C ≤14 days.',
    )
  })

  it('keeps canonical procedure order and block identity without rewriting definitions', () => {
    const blocks = [
      {
        id: 'step-2',
        type: 'procedure_step',
        payload: { text: 'Record yield ≥80%.', stepNumber: 2 },
      },
      {
        id: 'step-3',
        type: 'procedure_step',
        payload: { text: 'Record turbidity ≤20 NTU.', stepNumber: 3 },
      },
    ]
    const before = structuredClone(blocks)
    const { container } = render(<ProtocolDocument blocks={blocks} />)
    expect(
      [...container.querySelectorAll('[data-step-block-id]')].map((element) =>
        element.getAttribute('data-step-block-id'),
      ),
    ).toEqual(['step-2', 'step-3'])
    expect(blocks).toEqual(before)
    expect(screen.getByText('Record yield ≥80%.')).toBeTruthy()
    expect(screen.getByText('Record turbidity ≤20 NTU.')).toBeTruthy()
  })

  it('reports invalid evidence instead of quietly dropping it', () => {
    render(
      <ProtocolDocument
        blocks={[{ id: 'invalid', type: 'rich_text', payload: { doc: null } }]}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'This document block couldn’t be read.',
    )
  })

  it('distinguishes no document from an unreadable document', () => {
    render(<ProtocolDocument blocks={[]} />)
    expect(screen.getByText(/no document text yet/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
