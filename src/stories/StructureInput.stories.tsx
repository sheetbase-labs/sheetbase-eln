import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { StructurePicture } from '#/components/registry/structure-input'

/**
 * A structure drawn as a picture
 * (`src/components/registry/structure-input.tsx`). The drawing dialog needs
 * the chemistry library, so this story shows the picture from a fixed drawing.
 */
const BENZENE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,15 80,32 80,68 50,85 20,68 20,32" fill="none" stroke="currentColor" stroke-width="3"/><polygon points="50,27 70,38 70,62 50,73 30,62 30,38" fill="none" stroke="currentColor" stroke-width="2"/></svg>'

const meta = {
  title: 'Registry/StructurePicture',
  component: StructurePicture,
  args: { svg: BENZENE, label: 'Benzene', height: 120 },
} satisfies Meta<typeof StructurePicture>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
