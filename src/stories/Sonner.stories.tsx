import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Toaster } from '#/components/ui/sonner'
import { Button } from '#/components/ui/button'
import { toast } from 'sonner'

const meta = {
  title: 'UI/Sonner',
  component: Toaster,
  tags: ['autodocs'],
} satisfies Meta<typeof Toaster>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Toaster />
      <Button
        onClick={() =>
          toast.success('Changes saved', {
            description: 'Your component preferences were updated.',
          })
        }
      >
        Show success
      </Button>
      <Button
        onClick={() =>
          toast.error('Import failed', {
            description: 'Two rows contain invalid sample identifiers.',
          })
        }
      >
        Show error
      </Button>
      <Button
        onClick={() =>
          toast.info('Review required', {
            description: 'Complete the reviewer checklist before signing.',
          })
        }
      >
        Show info
      </Button>
      <Button
        onClick={() =>
          toast.warning('Low stock', {
            description: 'Material RGT-ENZ-0001 is below reorder threshold.',
          })
        }
      >
        Show warning
      </Button>
      <Button
        onClick={() =>
          toast.promise(new Promise((resolve) => setTimeout(resolve, 2000)), {
            loading: 'Processing...',
            success: 'Done!',
            error: 'Failed',
          })
        }
      >
        Show promise
      </Button>
    </div>
  ),
}
export const WithAction: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast('Experiment archived', {
            action: { label: 'Undo', onClick: () => {} },
          })
        }
      >
        Archive experiment
      </Button>
    </>
  ),
}
