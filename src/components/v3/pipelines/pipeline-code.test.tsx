/**
 * R5-SHELL-06 — pipeline code, temporary-store and step-navigation tests.
 *
 * The code block treats a statement as text: it is never executed or
 * interpreted, and content that is not valid UTF-16 renders as visibly broken
 * text rather than throwing. Temporary artefacts name the store that ends with
 * the run; step navigation stays the already-linkable route.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CodeBlock,
  PipelineSteps,
  TemporaryArtefact,
  TemporaryResultNote,
  codeText,
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
})

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
