/**
 * R5-SHELL-06 — pipeline store and step-navigation tests.
 *
 * Temporary artefacts name the store that ends with the run; step navigation
 * stays the already-linkable route. The code block itself is the kit's now, and
 * its own contract is tested at `src/components/v3/ui/code-block.test.tsx`.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PipelineSteps,
  TemporaryArtefact,
  TemporaryResultNote,
  pipelineStepsLink,
  pipelineStepsRoute,
} from './pipeline-code'

// Stub the router Link as a plain anchor, substituting route params so the
// destination the person actually follows can be asserted.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (href, [key, value]) => href.replace(`$${key}`, String(value)),
        to,
      )}
      {...props}
    >
      {children}
    </a>
  ),
}))

afterEach(cleanup)

describe('TemporaryArtefact', () => {
  it('marks an artefact whose store is temporary', () => {
    const { container } = render(
      <TemporaryArtefact>Temporary result</TemporaryArtefact>,
    )

    const marker = container.querySelector('[data-slot="temporary-artefact"]')
    expect(marker?.textContent).toBe('Temporary result')
    expect(marker?.className).toContain('border-dashed')
    expect(marker?.querySelector('svg')).not.toBeNull()
  })
})

describe('TemporaryResultNote', () => {
  it('states the retention rule where the run decides it', () => {
    render(<TemporaryResultNote />)

    expect(screen.getByText('Temporary result')).toBeTruthy()
    expect(
      screen.getByText(
        /dropped when the run ends\. Only the declared output is kept\./,
      ),
    ).toBeTruthy()
  })
})

describe('step navigation', () => {
  it('stays the already-linkable steps route, with no search parameter', () => {
    expect(pipelineStepsRoute).toBe('/pipelines/$pipelineId/steps')
    expect(pipelineStepsLink('p-1')).toEqual({
      to: '/pipelines/$pipelineId/steps',
      params: { pipelineId: 'p-1' },
    })
    expect(pipelineStepsLink('p-1')).not.toHaveProperty('search')
  })

  it('renders the stored steps in run order with their code', () => {
    const { container } = render(
      <PipelineSteps
        pipelineId="p-1"
        steps={[
          { name: 'Clean', language: 'sql', statement: 'select 1' },
          { name: 'Score', language: 'sql', statement: 'select 2' },
        ]}
      />,
    )

    const steps = container.querySelectorAll('[data-slot="pipeline-step"]')
    expect(steps).toHaveLength(2)
    expect(steps[0].textContent).toContain('1 · Clean · sql')
    expect(steps[1].textContent).toContain('2 · Score · sql')
    expect(steps[0].querySelector('code')?.textContent).toBe('select 1')
    expect(
      container.querySelectorAll('[data-slot="temporary-artefact"]'),
    ).toHaveLength(2)
  })

  it('links a step to the steps route, not to a ?step= parameter', () => {
    render(
      <PipelineSteps
        pipelineId="p-1"
        steps={[{ name: 'Clean', language: 'sql', statement: 'select 1' }]}
      />,
    )

    const link = screen.getByRole('link', { name: 'Edit steps' })
    expect(link.getAttribute('href')).toBe('/pipelines/p-1/steps')
    expect(link.getAttribute('href')).not.toContain('step=')
  })
})
