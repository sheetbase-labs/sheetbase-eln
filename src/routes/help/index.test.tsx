/**
 * The help centre's release list: "· running here" marks the release the
 * deployment actually reports, and nothing when that release is not listed.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './index'

const HelpCentre = Route.options.component as React.ComponentType

const help = vi.hoisted(() => ({
  value: undefined as
    | {
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
    | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
    options: config,
  }),
  redirect: (options: unknown) => options,
  Outlet: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

vi.mock('#/lib/help', () => ({ useHelp: () => help.value }))

vi.mock('#/components/shortcuts/shortcut-provider', () => ({
  useShortcuts: () => ({ registry: { inScope: () => [] } }),
}))

function helpData(version: string) {
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

describe('help release list', () => {
  it('marks only the release the deployment reports', () => {
    render(<HelpCentre />)

    const running = screen.getAllByText('· running here')
    expect(running).toHaveLength(1)
    const entry = screen.getByText('Sheetbase 3.4.0').closest('article')
    expect(within(entry!).getByText('· running here')).toBeTruthy()
  })

  it('claims no running release when the reported version is not listed', () => {
    help.value = helpData('0.0.0-dev')
    render(<HelpCentre />)

    expect(screen.queryByText('· running here')).toBeNull()
  })
})
