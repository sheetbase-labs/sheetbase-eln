/**
 * R5-SHELL-06 — pipeline store and step-navigation tests.
 *
 * Temporary artefacts name the store that ends with the run; step navigation
 * stays the already-linkable route. The code block itself is the kit's now, and
 * its own contract is tested at `src/components/ui/code-block.test.tsx`.
 */
import { cleanup, render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  PipelineSteps,
  TemporaryArtefact,
  TemporaryResultNote,
} from './pipeline-code'

async function renderWithRouter(node: ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()

  return render(<RouterProvider router={router} />)
}

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
  it('renders the initial transform before further steps, with their stored code', async () => {
    const { container } = await renderWithRouter(
      <PipelineSteps
        pipelineId="p-1"
        transform={{
          name: 'Transform',
          language: 'python',
          statement: 'return inputs',
        }}
        steps={[
          { name: 'Clean', language: 'sql', statement: 'select 1' },
          { name: 'Score', language: 'sql', statement: 'select 2' },
        ]}
      />,
    )

    const steps = container.querySelectorAll('[data-slot="pipeline-step"]')
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toContain('1 · Transform · python')
    expect(steps[1].textContent).toContain('2 · Clean · sql')
    expect(steps[2].textContent).toContain('3 · Score · sql')
    expect(steps[0].querySelector('code')?.textContent).toBe('return inputs')
    expect(steps[1].querySelector('code')?.textContent).toBe('select 1')
    expect(
      container.querySelectorAll('[data-slot="temporary-artefact"]'),
    ).toHaveLength(3)
  })

  it('links a step to the steps route, not to a ?step= parameter', async () => {
    await renderWithRouter(
      <PipelineSteps
        pipelineId="p-1"
        steps={[{ name: 'Clean', language: 'sql', statement: 'select 1' }]}
      />,
    )

    const link = screen.getByRole('link', { name: 'Edit steps' })
    expect(link.getAttribute('href')).toBe('/pipelines/p-1/steps')
    expect(link.getAttribute('href')).not.toContain('?')
  })
})
