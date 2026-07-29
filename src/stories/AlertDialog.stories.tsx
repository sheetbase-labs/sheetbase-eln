import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Button } from '#/components/ui/button'
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
} from '#/components/ui/alert-dialog'

const meta = {
  title: 'UI/AlertDialog',
  component: AlertDialog,
  tags: ['autodocs'],
} satisfies Meta<typeof AlertDialog>
export default meta
type Story = StoryObj<typeof meta>
const Demo = ({ destructive = false }) => (
  <AlertDialog defaultOpen>
    <AlertDialogTrigger asChild>
      <Button variant={destructive ? 'destructive' : 'outline'}>
        {destructive ? 'Delete record' : 'Leave page'}
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {destructive ? 'Delete this record?' : 'Discard changes?'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className={
            destructive ? 'bg-destructive text-destructive-foreground' : ''
          }
        >
          Continue
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)
export const Default: Story = { render: () => <Demo /> }
export const Destructive: Story = { render: () => <Demo destructive /> }
