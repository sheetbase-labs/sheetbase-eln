import { createFileRoute } from '@tanstack/react-router'
import {
  Activity,
  Box,
  Check,
  FlaskConical,
  Folder,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Table2,
  UserRound,
} from 'lucide-react'

import { useTheme } from '#/components/theme-provider'
import { StatusBadge } from '#/components/scientific'
import { NotebookBlock } from '#/components/notebook'
import { ChartFrame, PlateMap } from '#/components/viz'
import type { PlateWell } from '#/components/viz'
import { AuditTrail, ApprovalStepper } from '#/components/audit'
import type { AuditEvent, ApprovalStepDef } from '#/components/audit'
import {
  RecordHeader,
  Inspector,
  PropertyList,
  Property,
  LinkedRecordList,
  FileList,
  CheckList,
  ActivityFeed,
  CommentList,
} from '#/components/record'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui'
import { contrastRatio, oklchToSrgb } from '#/lib/contrast'
import type { Oklch } from '#/lib/contrast'
import { cn } from '#/lib/utils'

/**
 * UI-001 visual review page. Shows the reconciled design tokens — colour,
 * typography, spacing, radius, focus rings — and the theme/density toggles
 * so a reviewer can compare production against DESIGN.md, the brand guide
 * mockup and the concept system without running Storybook.
 *
 * This is a review surface, not a product screen. It has no auth gate so a
 * reviewer can load it before sign-in is configured; it must not expose any
 * business data.
 */
export const Route = createFileRoute('/foundations')({
  component: FoundationsPage,
})

function FoundationsPage() {
  const { theme, setTheme, density, setDensity } = useTheme()
  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Foundations
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
              Visual rules and semantic tokens
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              The reconciled Sheetbase token set. Instrument Sans for headings,
              Inter for body, controls and data. A single decisive blue,
              restrained semantic colours, fine borders, low elevation. Compare
              with DESIGN.md and the concept system.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Theme"
              className="flex items-center rounded-md border bg-card p-0.5"
            >
              <ToggleButton
                active={theme === 'light'}
                onClick={() => setTheme('light')}
                label="Light"
              >
                <Sun className="size-3.5" /> Light
              </ToggleButton>
              <ToggleButton
                active={theme === 'dark'}
                onClick={() => setTheme('dark')}
                label="Dark"
              >
                <Moon className="size-3.5" /> Dark
              </ToggleButton>
            </div>
            <div
              role="group"
              aria-label="Density"
              className="flex items-center rounded-md border bg-card p-0.5"
            >
              <ToggleButton
                active={density === 'comfortable'}
                onClick={() => setDensity('comfortable')}
                label="Comfortable"
              >
                Comfortable
              </ToggleButton>
              <ToggleButton
                active={density === 'compact'}
                onClick={() => setDensity('compact')}
                label="Compact"
              >
                Compact
              </ToggleButton>
            </div>
          </div>
        </header>

        <Section
          id="colour"
          title="Colour"
          description="Product code uses semantic variables (primary, border, muted) — never literal palette values."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {COLOUR_TOKENS.map((t) => (
              <TokenSwatch key={t.name} {...t} />
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              In progress
            </span>
            <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
              Needs review
            </span>
            <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300">
              Failed
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              Expired
            </span>
            <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              Archived
            </span>
          </div>
        </Section>

        <Section
          id="typography"
          title="Typography"
          description="Instrument Sans for headings; Inter for body, controls and data. No marketing-scale type."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Preview title="Interface hierarchy">
              <div className="space-y-5">
                <TypeRow label="Page title · 24/32 semibold">
                  <p className="font-display text-2xl font-semibold tracking-tight">
                    Virus Stability at 4 °C
                  </p>
                </TypeRow>
                <TypeRow label="Section title · 18/26 semibold">
                  <p className="font-display text-lg font-semibold">
                    Experimental design
                  </p>
                </TypeRow>
                <TypeRow label="Component title · 14/20 semibold">
                  <p className="text-sm font-semibold">Linked samples</p>
                </TypeRow>
                <TypeRow label="Body · 14/22 regular">
                  <p className="max-w-lg text-sm leading-[1.55]">
                    Evaluate the stability of concentrated lentiviral vector
                    when stored at 4 °C over 28 days.
                  </p>
                </TypeRow>
              </div>
            </Preview>
            <Preview title="Data typography">
              <div className="space-y-4">
                <TypeRow label="Tabular data">
                  <span className="font-mono text-sm tabular-nums">
                    3.20E+08 TU/mL
                  </span>
                </TypeRow>
                <TypeRow label="Scientific nums">
                  <span className="scientific-nums text-sm">
                    1.42 × 10⁻⁶ mol/L
                  </span>
                </TypeRow>
                <TypeRow label="Identifier">
                  <span className="font-mono text-xs">EXP-2025-0014</span>
                </TypeRow>
                <TypeRow label="Caption">
                  <span className="text-xs text-muted-foreground">
                    Updated 2 hours ago by Gareth Price
                  </span>
                </TypeRow>
              </div>
            </Preview>
          </div>
        </Section>

        <Section id="spacing" title="Spacing, radius and elevation">
          <div className="grid gap-4 lg:grid-cols-3">
            <Preview title="8-point spacing">
              <div className="flex items-end gap-3">
                {[4, 8, 12, 16, 24, 32, 48, 64].map((v) => (
                  <div key={v} className="flex flex-col items-center gap-2">
                    <div
                      className="rounded-sm bg-primary/20"
                      style={{ width: v, height: v }}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </Preview>
            <Preview title="Radius">
              <div className="flex items-end gap-4">
                {[4, 6, 8, 12, 16].map((v) => (
                  <div key={v} className="flex flex-col items-center gap-2">
                    <div
                      className="size-14 border bg-muted/50"
                      style={{ borderRadius: v }}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {v}px
                    </span>
                  </div>
                ))}
              </div>
            </Preview>
            <Preview title="Elevation">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'border', cls: 'border' },
                  { label: 'shadow-xs', cls: 'shadow-xs' },
                  { label: 'shadow-md', cls: 'shadow-md' },
                ].map((v) => (
                  <div
                    key={v.label}
                    className={cn(
                      'flex h-20 items-end rounded-lg border bg-card p-2',
                      v.cls,
                    )}
                  >
                    <span className="text-[10px] text-muted-foreground">
                      {v.label}
                    </span>
                  </div>
                ))}
              </div>
            </Preview>
          </div>
        </Section>

        <Section
          id="focus"
          title="Focus rings"
          description="Visible focus is required for every interactive control (DESIGN.md). Signal Blue ring, 2px outline, offset."
        >
          <div className="flex flex-wrap gap-3">
            <button className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              Outline button
            </button>
            <a
              href="#focus"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Primary link
            </a>
            <input
              aria-label="Sample input"
              className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              placeholder="Focus me"
            />
          </div>
        </Section>

        <Section
          id="icons"
          title="Iconography"
          description="Lucide icons at 1.5–2px stroke, normally 16px within controls."
        >
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {[
              FlaskConical,
              Folder,
              Table2,
              Activity,
              ShieldCheck,
              UserRound,
              Search,
              Box,
              Check,
            ].map((Icon, i) => (
              <div
                key={i}
                className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border bg-card"
              >
                <Icon className="size-5" />
                <span className="text-[10px] text-muted-foreground">
                  16–20px
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="primitives"
          title="Core primitives"
          description="The shadcn primitives the next tickets build on. Consistent sizes, visible focus, disabled state, destructive confirmation, keyboard-operable overlays, and programmatic label/description/error wiring."
        >
          <PrimitivesGrid />
        </Section>

        <Section
          id="record"
          title="Record header & inspector"
          description="The compact record header and contextual inspector (UI-004). Every header field is optional; the inspector has skeleton, no-selection, unavailable and permission-denied states."
        >
          <RecordPreview />
        </Section>

        <Section
          id="notebook"
          title="Notebook & visualisation frames"
          description="NotebookBlock, ChartFrame and PlateMap (UI-006) — presentational frames with selected/editing/invalid/locked/loading states, live/snapshot charts, provenance, legend and keyboard-operable plate wells."
        >
          <NotebookVizPreview />
        </Section>

        <Section
          id="audit"
          title="Audit trail & approval workflow"
          description="AuditTrail and ApprovalStepper (UI-007) - presentational, display-only components. Typed events and immutable review state; pending, active, completed, rejected, returned and unavailable steps; long histories stay scrollable; screen readers get complete sentences rather than connector graphics."
        >
          <AuditApprovalPreview />
        </Section>

        <Section
          id="contrast"
          title="Contrast checks (WCAG 2.2 AA)"
          description="The common token combinations a scientist reads: body on background, muted on background, primary on primary-foreground, destructive on its foreground."
        >
          <ContrastGrid />
        </Section>

        <footer className="mt-12 border-t pt-6 text-xs text-muted-foreground">
          Compare with <code>DESIGN.md</code>, the brand guide mockup and{' '}
          <code>Concepts/sheetbase-ui-system-v2</code>. Toggle theme and density
          in the header; preferences persist to localStorage.
        </footer>
      </div>
    </div>
  )
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-6">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Preview({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )
}

function TypeRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

interface TokenSwatchProps {
  name: string
  value: string
  varName: string
}

function TokenSwatch({ name, value, varName }: TokenSwatchProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div
        className="h-16 w-full border-b"
        style={{ background: `var(${varName})` }}
      />
      <div className="p-2.5">
        <p className="text-sm font-semibold">{name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {value}
        </p>
      </div>
    </div>
  )
}

const COLOUR_TOKENS: TokenSwatchProps[] = [
  { name: 'Primary', value: 'oklch(0.55 0.19 255)', varName: '--primary' },
  {
    name: 'Foreground',
    value: 'oklch(0.19 0.018 260)',
    varName: '--foreground',
  },
  { name: 'Muted', value: 'oklch(0.968 0.005 260)', varName: '--muted' },
  { name: 'Border', value: 'oklch(0.91 0.009 260)', varName: '--border' },
  {
    name: 'Destructive',
    value: 'oklch(0.61 0.22 27)',
    varName: '--destructive',
  },
  { name: 'Accent', value: 'oklch(0.95 0.018 255)', varName: '--accent' },
  { name: 'Card', value: 'oklch(1 0 0)', varName: '--card' },
  { name: 'Sidebar', value: 'oklch(0.982 0.004 260)', varName: '--sidebar' },
]

/**
 * Live showcase of the record header and contextual inspector (UI-004).
 * Demonstrates a fully-populated record header and a tabbed inspector with
 * properties, linked records, files, checks, activity and comments.
 */
function RecordPreview() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <RecordHeader
          recordType="Experiment"
          title="Lentivector stability — 4°C hold"
          identifier="EXP-2025-0014"
          status={<StatusBadge domain="experiment" status="in-progress" />}
          phase={
            <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Phase 2
            </span>
          }
          owner={{ name: 'Gareth Price', initials: 'GP' }}
          updatedAt="2h ago"
          contributors={Array.from({ length: 4 }, (_, i) => ({
            name: `Member ${i + 1}`,
          }))}
          tags={
            <>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                stability
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                lentivirus
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                gcPCR
              </span>
            </>
          }
          actions={
            <Button variant="outline" size="sm">
              Share
            </Button>
          }
        />
      </div>
      <div className="h-[28rem] overflow-hidden rounded-lg border bg-card">
        <Inspector
          recordType="Experiment"
          title="4°C hold"
          tabs={[
            {
              id: 'properties',
              label: 'Properties',
              content: (
                <PropertyList>
                  <Property label="Project ID" mono>
                    EXP-2025-0014
                  </Property>
                  <Property label="Status">In progress</Property>
                  <Property label="Phase">Phase 2</Property>
                  <Property label="Created">14 Jul 2025, 09:12</Property>
                  <Property label="Owner">Gareth Price</Property>
                  <Property label="Review status">
                    <StatusBadge domain="review" status="pending" />
                  </Property>
                </PropertyList>
              ),
            },
            {
              id: 'links',
              label: 'Links',
              badge: 3,
              content: (
                <LinkedRecordList
                  items={[
                    {
                      id: '1',
                      type: 'Sample',
                      title: 'Sample 28',
                      meta: 'Cell line',
                      icon: FlaskConical,
                    },
                    {
                      id: '2',
                      type: 'Protocol',
                      title: 'Stability assay SOP',
                      meta: 'v3',
                      icon: Folder,
                    },
                    {
                      id: '3',
                      type: 'Dataset',
                      title: 'Raw qPCR',
                      meta: '12 wells',
                      icon: Table2,
                    },
                  ]}
                />
              ),
            },
            {
              id: 'files',
              label: 'Files',
              content: (
                <FileList
                  items={[
                    {
                      id: '1',
                      name: 'Stability_Assay_Protocol.pdf',
                      meta: '120 KB',
                    },
                    {
                      id: '2',
                      name: 'Lentivirus_Handling_SOP.pdf',
                      meta: '88 KB',
                    },
                  ]}
                />
              ),
            },
            {
              id: 'checks',
              label: 'Checks',
              content: (
                <CheckList
                  items={[
                    {
                      id: '1',
                      label: 'Data integrity',
                      state: 'pass' as const,
                    },
                    {
                      id: '2',
                      label: 'Instrument calibration',
                      state: 'pass' as const,
                    },
                    {
                      id: '3',
                      label: 'Reagent expiry',
                      state: 'warning' as const,
                      detail: 'Due in 10d',
                    },
                    {
                      id: '4',
                      label: 'Training records',
                      state: 'pending' as const,
                    },
                  ]}
                />
              ),
            },
            {
              id: 'activity',
              label: 'Activity',
              content: (
                <ActivityFeed
                  items={[
                    {
                      id: '1',
                      actor: { name: 'Gareth Price', initials: 'GP' },
                      action: 'updated',
                      target: 'Protocol 4',
                      at: '2h ago',
                    },
                    {
                      id: '2',
                      actor: { name: 'Mia Chen', initials: 'MC' },
                      action: 'commented on',
                      target: 'Run 12',
                      at: '5h ago',
                    },
                  ]}
                />
              ),
            },
            {
              id: 'comments',
              label: 'Comments',
              badge: 2,
              content: (
                <CommentList
                  items={[
                    {
                      id: '1',
                      author: { name: 'Mia Chen', initials: 'MC' },
                      body: 'Looks good — approve after the repeat.',
                      at: '1h ago',
                    },
                    {
                      id: '2',
                      author: { name: 'Gareth Price', initials: 'GP' },
                      body: 'Repeating run 12 today.',
                      at: '30m ago',
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  )
}

function NotebookVizPreview() {
  const plateWells: PlateWell[] = Array.from({ length: 96 }, (_, i) => ({
    row: Math.floor(i / 12),
    col: i % 12,
    value: ((i * 7 + (i % 5)) % 10) / 10,
  }))
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <NotebookBlock
          label="H2"
          title="Methods"
          state="selected"
          draggable
          actions={
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          }
          menuItems={[
            { id: 'insert', label: 'Insert below', separatorAfter: true },
            { id: 'duplicate', label: 'Duplicate' },
            { id: 'delete', label: 'Delete block' },
          ]}
        >
          <p className="text-sm leading-6 text-muted-foreground">
            Samples were held at 4 degrees C and sampled at days 0, 7, 14 and 28
            for gcPCR quantification.
          </p>
        </NotebookBlock>
        <NotebookBlock label="Chart" state="loading">
          chart
        </NotebookBlock>
        <NotebookBlock label="Table" state="invalid">
          <p className="text-sm text-destructive">
            Two rows reference missing samples.
          </p>
        </NotebookBlock>
      </div>
      <div className="space-y-4">
        <ChartFrame
          title="Assay trend"
          subtitle="Vector genome copy number"
          mode="live"
          provenance="Source: Stability assay - 2025-07-14"
          alt="Line chart of vector genome copy number over 14 days for two lots; lot A rises from 1e6 to 1e8, lot B plateaus at 1e7."
          legend={
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-[2px] bg-blue-500" />
                Lot LWV-250601
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-[2px] bg-emerald-500" />
                Lot LWV-250602
              </span>
            </div>
          }
        >
          <div className="flex h-40 items-end justify-center rounded-md border bg-muted/30 text-xs text-muted-foreground">
            chart canvas
          </div>
        </ChartFrame>
        <ChartFrame title="Snapshot" mode="snapshot" loading>
          chart
        </ChartFrame>
        <div className="rounded-lg border bg-card p-4">
          <PlateMap wells={plateWells} ariaLabel="96-well plate" compact />
        </div>
      </div>
    </div>
  )
}

/**
 * Live showcase of the core primitives (UI-002). Every interactive element
 * here is real, not a screenshot — focus rings, disabled state, keyboard
 * behaviour and overlay semantics all work as they will in product screens.
 */
function PrimitivesGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Preview title="Buttons — variants, sizes, disabled">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Add">
            <Plus className="size-4" />
          </Button>
        </div>
      </Preview>

      <Preview title="Badges — semantic statuses">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Archived</Badge>
          <Badge variant="success">In progress</Badge>
          <Badge variant="info">Needs review</Badge>
          <Badge variant="warning">Expiring</Badge>
          <Badge variant="danger">Failed</Badge>
          <Badge variant="violet">Custom</Badge>
        </div>
      </Preview>

      <Preview title="Field — label, description, error">
        <Field>
          <FieldLabel htmlFor="sample-title">Experiment title</FieldLabel>
          <Input
            id="sample-title"
            aria-describedby="sample-title-help sample-title-err"
            aria-invalid="true"
            defaultValue="Virus Stability"
          />
          <FieldDescription id="sample-title-help">
            Shown in the project notebook list.
          </FieldDescription>
          <FieldError id="sample-title-err">
            A notebook with this title already exists in this project.
          </FieldError>
        </Field>
        <div className="mt-4">
          <FieldLabel htmlFor="sample-notes">Notes</FieldLabel>
          <Textarea id="sample-notes" placeholder="Free-text observations…" />
        </div>
      </Preview>

      <Preview title="Tabs — keyboard navigation">
        <Tabs defaultValue="properties">
          <TabsList>
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>
          <TabsContent value="properties">
            <p className="text-sm text-muted-foreground">
              Property list placeholder.
            </p>
          </TabsContent>
          <TabsContent value="activity">
            <p className="text-sm text-muted-foreground">
              Audit trail placeholder.
            </p>
          </TabsContent>
          <TabsContent value="files">
            <p className="text-sm text-muted-foreground">
              Attachments placeholder.
            </p>
          </TabsContent>
        </Tabs>
      </Preview>

      <Preview title="Tooltip">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>Used inline in data tables.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Preview>

      <Preview title="Dropdown menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Rename…</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Archive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Preview>

      <Preview title="Destructive confirmation (AlertDialog)">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Delete notebook</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently delete notebook?</AlertDialogTitle>
              <AlertDialogDescription>
                All blocks, links and audit history will be removed. This cannot
                be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Preview>
    </div>
  )
}

// OKLCH token values mirrored from src/styles.css. The contrast test in
// src/lib/contrast.test.ts is the authoritative check; the runtime ratios
// here are computed from the same values so the review page can never show
// a ratio that disagrees with the test.
const CONTRAST_PAIRS: Array<{
  label: string
  fg: Oklch
  bg: Oklch
  fgVar: string
  bgVar: string
}> = [
  {
    label: 'Foreground on background',
    fgVar: 'var(--foreground)',
    bgVar: 'var(--background)',
    fg: { L: 0.19, C: 0.018, h: 260 },
    bg: { L: 0.995, C: 0.002, h: 260 },
  },
  {
    label: 'Muted-foreground on background',
    fgVar: 'var(--muted-foreground)',
    bgVar: 'var(--background)',
    fg: { L: 0.5, C: 0.02, h: 260 },
    bg: { L: 0.995, C: 0.002, h: 260 },
  },
  {
    label: 'Muted-foreground on muted',
    fgVar: 'var(--muted-foreground)',
    bgVar: 'var(--muted)',
    fg: { L: 0.5, C: 0.02, h: 260 },
    bg: { L: 0.968, C: 0.005, h: 260 },
  },
  {
    label: 'Primary-foreground on primary',
    fgVar: 'var(--primary-foreground)',
    bgVar: 'var(--primary)',
    fg: { L: 0.985, C: 0.002, h: 255 },
    bg: { L: 0.55, C: 0.19, h: 255 },
  },
  {
    label: 'Destructive-foreground on destructive',
    fgVar: 'var(--destructive-foreground)',
    bgVar: 'var(--destructive)',
    fg: { L: 0.985, C: 0.002, h: 27 },
    bg: { L: 0.55, C: 0.21, h: 27 },
  },
  {
    label: 'Foreground on card',
    fgVar: 'var(--foreground)',
    bgVar: 'var(--card)',
    fg: { L: 0.19, C: 0.018, h: 260 },
    bg: { L: 1, C: 0, h: 0 },
  },
]

function ContrastGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CONTRAST_PAIRS.map((p) => {
        // Light-theme ratio. Dark theme uses the same foreground/background
        // pairing with mirrored values (see src/lib/contrast.test.ts); the
        // test is the authoritative check for both themes.
        const ratio = contrastRatio(oklchToSrgb(p.fg), oklchToSrgb(p.bg))
        const aa: 'pass' | 'fail' = ratio >= 4.5 ? 'pass' : 'fail'
        return (
          <div
            key={p.label}
            className="rounded-lg border p-4"
            style={{ background: p.bgVar, color: p.fgVar }}
          >
            <p className="text-sm font-semibold">{p.label}</p>
            <p className="mt-1 text-sm">
              The quick brown fox jumps over the lazy dog. 3.20E+08 TU/mL
            </p>
            <p className="mt-3 text-xs opacity-80">
              {ratio.toFixed(1)}:1 ·{' '}
              <span
                className={cn(
                  'font-semibold',
                  aa === 'pass' ? 'text-emerald-600' : 'text-red-600',
                )}
              >
                {aa === 'pass' ? 'AA pass' : 'AA fail'}
              </span>
            </p>
          </div>
        )
      })}
    </div>
  )
}

const auditEvents: AuditEvent[] = [
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
    type: 'review-requested',
    title: 'Review requested',
    actor: { name: 'Gareth Price' },
    timestamp: '2025-07-14 11:42',
    target: 'Protocol EXP-2174',
  },
  {
    id: '4',
    type: 'review-started',
    title: 'Scientific review started',
    actor: { name: 'Emma Liu' },
    timestamp: '2025-07-15 08:03',
  },
  {
    id: '5',
    type: 'review-started',
    title: 'Review returned for revision',
    actor: { name: 'Emma Liu' },
    timestamp: '2025-07-15 15:20',
  },
  {
    id: '6',
    type: 'created',
    title: 'Unknown user re-opened the experiment',
    actor: { name: 'Deleted user', unknown: true },
    timestamp: '2025-07-16 09:55',
  },
]

const approvalSteps: ApprovalStepDef[] = [
  { id: 'draft', title: 'Draft', role: 'Author' },
  { id: 'sci', title: 'Scientific review', role: 'Emma Liu' },
  { id: 'qa', title: 'QA review', role: 'QA team' },
  { id: 'sign', title: 'Sign-off', role: 'PI - R. Okafor' },
  { id: 'lock', title: 'Approved & locked' },
]

function AuditApprovalPreview() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Audit trail</h3>
        <AuditTrail
          events={auditEvents}
          totalCount={84}
          onLoadMore={() => {}}
        />
        <h3 className="pt-2 text-sm font-semibold">Loading state</h3>
        <AuditTrail events={[]} loading />
        <h3 className="pt-2 text-sm font-semibold">Empty state</h3>
        <AuditTrail events={[]} />
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Approval workflow</h3>
        <ApprovalStepper
          steps={approvalSteps}
          reviewState={{
            draft: {
              state: 'completed',
              actor: { name: 'Gareth Price' },
              at: '2025-07-14 09:12',
            },
            sci: {
              state: 'returned',
              actor: { name: 'Emma Liu' },
              at: '2025-07-15 15:20',
            },
            qa: { state: 'unavailable' },
            sign: { state: 'unavailable' },
            lock: { state: 'unavailable' },
          }}
        />
        <h3 className="pt-2 text-sm font-semibold">Active review</h3>
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
        <h3 className="pt-2 text-sm font-semibold">Rejected at QA</h3>
        <ApprovalStepper
          steps={approvalSteps}
          reviewState={{
            draft: { state: 'completed' },
            sci: {
              state: 'completed',
              actor: { name: 'Emma Liu' },
              at: '2025-07-16 10:00',
            },
            qa: {
              state: 'rejected',
              actor: { name: 'QA team' },
              at: '2025-07-16 14:22',
            },
            sign: { state: 'unavailable' },
            lock: { state: 'unavailable' },
          }}
        />
      </div>
    </div>
  )
}
