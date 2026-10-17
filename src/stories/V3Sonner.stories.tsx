import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import { Toaster, toast } from '#/components/v3/ui/sonner'

/**
 * Feedback for an action you just took. It is bottom centre, lasts 6 s, and sits
 * on the inverse surface with a dot whose colour carries success or failure. The
 * sentence is the message; nothing else on the screen changes to say the same
 * thing.
 *
 * The legacy `UI/Sonner` story covers `src/components/ui/sonner.tsx`, whose
 * `Toaster` is the stock one. This is the styled forward one the app mounts.
 */
const meta = {
  title: 'v3 kit/Sonner',
  component: Toaster,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Toaster>
export default meta
type Story = StoryObj<typeof meta>

/** Fire the toasts by hand: they are the only thing this component renders. */
export const Default: Story = {
  render: () => (
    <>
      <Toaster />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => toast('Calibration recorded')}>
          Record a calibration
        </Button>
        <Button
          onClick={() =>
            toast.error('Could not record the calibration', {
              description: 'The database refused it.',
            })
          }
        >
          Fail one
        </Button>
      </div>
    </>
  ),
}

/** A reversible action offers it, which is the one control a toast may carry. */
export const WithUndo: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast('Sample withdrawn', {
            action: { label: 'Undo', onClick: () => {} },
          })
        }
      >
        Withdraw a sample
      </Button>
    </>
  ),
}

/** A failure keeps its sentence short and puts the reason on the second line. */
export const FailureWithReason: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast.error('Import failed', {
            description: 'Two rows contain duplicate sample identifiers.',
          })
        }
      >
        Import a file with two bad rows
      </Button>
    </>
  ),
}
