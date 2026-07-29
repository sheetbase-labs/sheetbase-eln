import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'

const meta = {
  title: 'UI/Alert',
  component: Alert,
  tags: ['autodocs'],
} satisfies Meta<typeof Alert>
export default meta
type Story = StoryObj<typeof meta>

const Example = ({
  variant = 'default',
}: {
  variant?: 'default' | 'destructive' | 'warning' | 'info'
}) => (
  <Alert variant={variant} className="max-w-md">
    <AlertTitle>Experiment status</AlertTitle>
    <AlertDescription>Your changes have been recorded.</AlertDescription>
  </Alert>
)
export const Default: Story = { render: () => <Example /> }
export const Variants: Story = {
  render: () => (
    <div className="grid max-w-md gap-3">
      <Example variant="info" />
      <Example variant="warning" />
      <Example variant="destructive" />
    </div>
  ),
}
