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
