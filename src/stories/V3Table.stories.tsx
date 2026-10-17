import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableStateRow,
} from '#/components/v3/ui/table'

/**
 * The registry table: 32px rows, 12px muted headers on `surface-muted`, tabular
 * numerals. `TableBody` owns the two body states a table without records needs —
 * `loading` shows a skeleton row, `empty` the message a caller gives — so a
 * screen never renders a header over nothing.
 *
 * The legacy `UI/Table` story covers `src/components/ui/table.tsx`.
 */
const meta = {
  title: 'v3 kit/Table',
  component: Table,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Table>
export default meta
type Story = StoryObj<typeof meta>

const ROWS = [
  [
    'PL-0007',
    'Extraction and clarification',
    'Virus recovery v4',
    '12',
    'Valid',
  ],
  ['PL-0008', 'Purification train', 'Chromatography v2', '9', 'Valid'],
  [
    'PL-0009',
    'Formulation and fill',
    'Buffer exchange v1',
    '6',
    'Needs review',
  ],
]

const Body = ({ rows = ROWS }: { rows?: string[][] }) => (
  <>
    <TableHeader>
      <TableRow>
        <TableHead>Pipeline</TableHead>
        <TableHead>Step</TableHead>
        <TableHead>Model</TableHead>
        <TableHead align="right">Runs</TableHead>
        <TableHead>Validation</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row) => (
        <TableRow key={row[0]}>
          <TableCell className="font-mono text-label">{row[0]}</TableCell>
          <TableCell>{row[1]}</TableCell>
          <TableCell>{row[2]}</TableCell>
          <TableCell align="right">{row[3]}</TableCell>
          <TableCell>{row[4]}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </>
)

/** A table with rows, inside the box that carries the border and the overflow. */
export const Default: Story = {
  render: () => (
    <TableBox className="w-[720px]">
      <Table caption="Pipelines">
        <Body />
      </Table>
    </TableBox>
  ),
}

/** Selected rows keep their selection visible through the hover state. */
export const WithSelectedRow: Story = {
  render: () => (
    <TableBox className="w-[720px]">
      <Table caption="Pipelines">
        <TableHeader>
          <TableRow>
            <TableHead>Pipeline</TableHead>
            <TableHead>Step</TableHead>
            <TableHead>Model</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow selected>
            <TableCell className="font-mono text-label">PL-0007</TableCell>
            <TableCell>Extraction and clarification</TableCell>
            <TableCell>Virus recovery v4</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-mono text-label">PL-0008</TableCell>
            <TableCell>Purification train</TableCell>
            <TableCell>Chromatography v2</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableBox>
  ),
}

/** Loading: the header is current and the body says what is happening. */
export const Loading: Story = {
  render: () => (
    <TableBox className="w-[720px]">
      <Table caption="Pipelines">
        <TableHeader>
          <TableRow>
            <TableHead>Pipeline</TableHead>
            <TableHead>Step</TableHead>
            <TableHead>Model</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody loading colSpan={3} />
      </Table>
    </TableBox>
  ),
}

/** No rows: the caller's sentence, in the body, at the row height. */
export const Empty: Story = {
  render: () => (
    <TableBox className="w-[720px]">
      <Table caption="Pipelines">
        <TableHeader>
          <TableRow>
            <TableHead>Pipeline</TableHead>
            <TableHead>Step</TableHead>
            <TableHead>Model</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody colSpan={3} empty="No pipelines in this project yet." />
      </Table>
    </TableBox>
  ),
}

/**
 * `TableStateRow` is the state row on its own, for a body that owns its own
 * conditions rather than passing `loading` or `empty`.
 */
export const StateRowAlone: Story = {
  render: () => (
    <TableBox className="w-[720px]">
      <Table caption="Pipelines">
        <TableBody>
          <TableStateRow colSpan={3}>
            The validation service did not respond.
          </TableStateRow>
        </TableBody>
      </Table>
    </TableBox>
  ),
}
