/**
 * The help centre's release list: "· running here" marks the release the
 * deployment actually reports, and nothing when that release is not listed.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'

import { Route } from './index'

/** The route options the file-route factory stores; this suite reads `component`. */
interface FileRouteOptions {
  component?: React.ComponentType
}

/** The search the help centre accepts; this suite opens it with none. */
interface HelpSearch {
  topic?: string
}

/** The help payload the screen reads: the release it reports and the support details. */
interface HelpPayload {
  release: {
    version: string
    build: string
    released: string
    validation: { tone: string; label: string; detail: string }
    statement: string
  }
  support: {
    hours: string
    urgent: string
    diagnostics: string[]
    notIncluded: string
    integrated: boolean
  }
}

const help = vi.hoisted<{ value: HelpPayload | undefined }>(() => ({
  value: undefined,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time, and this suite renders the help screen on its own with the search the shell would supply.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: FileRouteOptions) => ({
    useSearch: (): HelpSearch => ({}),
    useNavigate: () => vi.fn(),
    options: config,
  }),
  redirect: (options: { to: string; search?: Record<string, string> }) =>
    options,
  Outlet: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- `useHelp` reads a TanStack Start server function, which has no server to answer it in this unit test; the double supplies the payload the screen renders.
vi.mock('#/lib/help', () => ({ useHelp: () => help.value }))

function helpData(version: string): HelpPayload {
  return {
    release: {
      version,
      build: version,
      released: '',
      validation: { tone: 'ok', label: 'Validated', detail: 'Validated.' },
      statement: '21 CFR Part 11 / EU GMP Annex 11 controlled system',
    },
    support: {
      hours: 'Mon–Fri, 08:00–18:00 UK time',
      urgent: 'For anything stopping GMP work, contact the IT service desk.',
      diagnostics: [],
      notIncluded: 'Record contents are never included.',
      integrated: false,
    },
  }
}

beforeEach(() => {
  help.value = helpData('3.4.0')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Renders the help centre as the shell mounts it, inside the shortcut provider. */
function renderHelp() {
  const HelpCentre = Route.options.component

  if (!HelpCentre) throw new Error('the help route declares no component')

  return render(
    <ShortcutProvider definitions={[]}>
      <HelpCentre />
    </ShortcutProvider>,
  )
}

describe('help release list', () => {
  it('marks only the release the deployment reports', () => {
    renderHelp()

    const running = screen.getAllByText('· running here')
    expect(running).toHaveLength(1)
    const entry = screen.getByText('Sheetbase 3.4.0').closest('article')
    expect(within(entry!).getByText('· running here')).toBeTruthy()
  })

  it('claims no running release when the reported version is not listed', () => {
    help.value = helpData('0.0.0-dev')
    renderHelp()

    expect(screen.queryByText('· running here')).toBeNull()
  })
})
