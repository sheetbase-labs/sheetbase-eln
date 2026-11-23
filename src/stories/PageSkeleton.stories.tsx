import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  ChipRowSkeleton,
  RecordBodySkeleton,
  SectionSkeleton,
  TableSkeleton,
  TitleSkeleton,
} from '#/components/ui/page-skeleton'

const meta = {
  title: 'UI/Page skeletons',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const List: Story = {
  render: () => <TableSkeleton columns={5} rows={8} />,
}

export const Home: Story = {
  render: () => (
    <div className="flex flex-col gap-7 px-4 py-4 md:px-6">
      <ChipRowSkeleton />
      <SectionSkeleton title="Awaiting your review" columns={4} rows={5} />
      <SectionSkeleton title="Continue working" columns={4} rows={6} />
    </div>
  ),
}

export const Record: Story = {
  render: () => (
    <>
      <div className="px-4 py-3 md:px-6">
        <TitleSkeleton label="Loading" />
      </div>
      <RecordBodySkeleton />
    </>
  ),
}
