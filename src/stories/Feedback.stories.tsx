import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Icon } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
import { Progress } from '#/components/v3/ui/progress'
import { Spinner } from '#/components/v3/ui/spinner'
import { Alert, AlertDescription, AlertTitle, Skeleton } from '#/components/ui'
import { EmptyState } from '#/components/v3/ui/empty-state'

const meta = { title: 'UI/Feedback', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Alerts: Story = {
  render: () => (
    <div className="grid gap-2">
      {(['default', 'info', 'warning', 'destructive'] as const).map((v) => (
        <Alert key={v} variant={v}>
          <Icon name="warn" />
          <AlertTitle>{v} result</AlertTitle>
          <AlertDescription>
            Three measurements are outside the validated range.
          </AlertDescription>
        </Alert>
      ))}
    </div>
  ),
}
export const Loading: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Spinner />
        Calculating curve fit…
      </div>
      <Progress label="Fitting the curve" value={68} />
      <Skeleton className="h-24 w-full" />
    </div>
  ),
}
export const Empty: Story = {
  render: () => (
    <EmptyState
      icon="flask"
      title="No experiments yet"
      description="Create an experiment or import an existing protocol."
      action={<Button>Create experiment</Button>}
    />
  ),
}
