import { cleanup, render } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AuditTrail, ApprovalStepper } from '#/components/audit'
import { NotebookBlock } from '#/components/notebook'
import { ChartFrame, PlateMap } from '#/components/viz'
import {
  RecordLink,
  StatusBadge,
  statusVocabularies,
} from '#/components/scientific'
import type { StatusDomain } from '#/components/scientific'
import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/ui'

// Stub the router Link as a plain anchor so no route tree is required.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: { to: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

/**
 * Catalogue accessibility checks (UI-008). These run axe-core against the
 * same production components the /foundations catalogue renders, in the
 * states a scientist can meet: default, loading, empty, error, disabled,
 * locked, permission-restricted and long histories. They are not a full
 * catalogue render (the route needs router/theme context) but they cover
 * the highest-value compositions for WCAG 2.2 AA.
 */

afterEach(() => cleanup())
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // jsdom does not lay out colour; the catalogue has a dedicated
      // contrast grid section for visual contrast review.
      'color-contrast': { enabled: false },
    },
  })
  if (results.violations.length > 0) {
    throw new Error(
      `axe violations:\n${JSON.stringify(
        results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.map((n) => n.html),
        })),
        null,
        2,
      )}`,
    )
  }
  expect(results.violations).toHaveLength(0)
}

const auditEvents = [
  {
    id: '1',
    type: 'created',
    title: 'Experiment created',
    actor: { name: 'Gareth Price' },
    timestamp: '2025-07-14 09:12',
  },
  {
    id: '2',
    type: 'uploaded',
    title: 'Dataset attached',
    actor: { name: 'Mia Chen' },
    timestamp: '2025-07-14 10:41',
    target: 'Stability_Raw_Data.csv',
  },
  {
    id: '3',
    type: 'review-started',
    title: 'Scientific review started',
    actor: { name: 'Emma Liu' },
    timestamp: '2025-07-15 08:03',
  },
]

const approvalSteps = [
  { id: 'draft', title: 'Draft', role: 'Author' },
  { id: 'sci', title: 'Scientific review', role: 'Emma Liu' },
  { id: 'qa', title: 'QA review', role: 'QA team' },
  { id: 'lock', title: 'Approved & locked' },
]

const domains: StatusDomain[] = ['experiment', 'review', 'sample', 'dataset']

describe('catalogue accessibility (UI-008)', () => {
  it('AuditTrail states have no axe violations', async () => {
    const { container } = render(
      <div>
        <AuditTrail
          events={auditEvents}
          totalCount={84}
          onLoadMore={() => {}}
        />
        <AuditTrail events={[]} loading />
        <AuditTrail events={[]} />
      </div>,
    )
    await expectNoViolations(container)
  })

  it('ApprovalStepper states have no axe violations', async () => {
    const { container } = render(
      <div>
        <ApprovalStepper
          steps={approvalSteps}
          reviewState={{
            draft: {
              state: 'completed',
              actor: { name: 'Gareth Price' },
              at: '2025-07-14 09:12',
            },
            sci: { state: 'active', at: '2025-07-15 08:03' },
          }}
        />
        <ApprovalStepper
          steps={approvalSteps}
          reviewState={{
            draft: { state: 'completed' },
            sci: {
              state: 'rejected',
              actor: { name: 'Emma Liu' },
              at: '2025-07-15 15:20',
            },
            qa: { state: 'unavailable' },
            lock: { state: 'unavailable' },
          }}
        />
      </div>,
    )
    await expectNoViolations(container)
  })

  it('StatusBadge and RecordLink states have no axe violations', async () => {
    const { container } = render(
      <div>
        {domains.map((domain) =>
          Object.entries(statusVocabularies[domain]).map(([key]) => (
            <StatusBadge
              key={`${domain}-${key}`}
              domain={domain}
              status={key}
            />
          )),
        )}
        <RecordLink
          type="Sample"
          title="EXP-2174-A1 bulk drug substance"
          meta="Lot A-2025-07-14 · 1,284,506 cells/mL"
          to="/projects"
        />
        <RecordLink
          type="Protocol"
          title="Stability-indicating gcPCR assay v3"
          meta="PR-118 · archived target"
          state="missing"
        />
        <RecordLink
          type="Dataset"
          title="Stability_Raw_Data_2025-07-14_final.csv"
          meta="DS-4082 · 4.2 MB"
          state="deleted"
        />
        <RecordLink
          type="Report"
          title="Q3 vector genome copy number report"
          meta="RP-0091 · restricted to QA"
          state="permission-restricted"
        />
      </div>,
    )
    await expectNoViolations(container)
  })

  it('NotebookBlock and visualisation frames have no axe violations', async () => {
    const wells = Array.from({ length: 96 }, (_, i) => ({
      row: Math.floor(i / 12),
      col: i % 12,
      value: ((i * 7 + (i % 5)) % 10) / 10,
    }))
    const { container } = render(
      <div>
        <NotebookBlock label="H2" title="Methods" state="selected">
          <p className="text-sm">
            Samples were held at 4 degrees C and sampled at days 0, 7, 14 and 28
            for gcPCR quantification.
          </p>
        </NotebookBlock>
        <NotebookBlock label="Table" state="invalid">
          <p className="text-sm text-destructive">
            Two rows reference missing samples.
          </p>
        </NotebookBlock>
        <NotebookBlock label="Chart" state="locked" title="Assay trend">
          <p className="text-sm">Locked content.</p>
        </NotebookBlock>
        <ChartFrame
          title="Assay trend"
          subtitle="Vector genome copy number"
          mode="live"
          provenance="Source: Stability assay - 2025-07-14"
          alt="Line chart of vector genome copy number over 14 days for two lots."
        >
          <p>chart body</p>
        </ChartFrame>
        <PlateMap wells={wells} />
      </div>,
    )
    await expectNoViolations(container)
  })

  it('disabled, error and form states have no axe violations', async () => {
    const { container } = render(
      <div>
        <Button disabled>Run assay</Button>
        <Input placeholder="Search samples" disabled />
        <p className="text-sm font-medium text-destructive">
          Failed to load experiment EXP-2174
        </p>
        <Button variant="secondary">Retry</Button>
      </div>,
    )
    await expectNoViolations(container)
  })
})
