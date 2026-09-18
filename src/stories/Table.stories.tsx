import { StatusBadge } from '#/components/scientific'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'

const meta = { title: 'UI/Table', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Samples: Story = {
  render: () => (
    <Table>
      <TableCaption>Samples linked to EXP-2026-0042</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Identifier</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Volume</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[
          ['SMP-2026-0142', 'Plasma aliquot', 'Frozen', '2.4 mL'],
          ['SMP-2026-0143', 'Serum control', 'Quarantined', '0.8 mL'],
        ].map((r) => (
          <TableRow key={r[0]}>
            <TableCell className="font-mono">{r[0]}</TableCell>
            <TableCell>{r[1]}</TableCell>
            <TableCell>
              <Badge variant={r[2] === 'Frozen' ? 'info' : 'warning'}>
                {r[2]}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono">{r[3]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Total</TableCell>
          <TableCell className="text-right">3.2 mL</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
}
export const Empty: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Identifier</TableHead>
          <TableHead>Sample</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell
            colSpan={2}
            className="h-24 text-center text-muted-foreground"
          >
            No matching samples
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

export const Quiet: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The home-page work-list treatment: sentence-case headings, quieter dividers, and room for secondary record metadata. Column sizing remains the responsibility of the consuming view.',
      },
    },
  },
  render: () => (
    <Table variant="quiet" className="table-fixed">
      <TableCaption>Recently edited records</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/2">Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[
          [
            'QC Trend Analysis — Q3 2026',
            'RPT-2026-0002',
            'Draft',
            '12 min ago',
          ],
          [
            'Virus Stability Study Report',
            'RPT-2026-0001',
            'in_review',
            '1 hr ago',
          ],
          [
            'Stability Study — Batch 2025-001',
            'EXP-2025-0001',
            'in_progress',
            '2 hr ago',
          ],
        ].map(([title, identifier, status, updated]) => (
          <TableRow key={identifier}>
            <TableCell>
              <p className="truncate font-medium">{title}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {identifier}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Lentivector Stability Study
              </p>
            </TableCell>
            <TableCell>
              <StatusBadge domain="experiment" status={status} />
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
              {updated}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}
