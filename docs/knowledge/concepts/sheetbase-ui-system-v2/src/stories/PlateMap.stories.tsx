import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { PlateMap } from '#/components/sheetbase/plate-map'

const meta = { title: 'Scientific/Plate map', component: PlateMap, tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta<typeof PlateMap>
export default meta
type Story = StoryObj<typeof meta>
export const NinetySixWell: Story = { render: () => <div className='w-[680px] rounded-lg border p-6'><div className='mb-4 text-sm font-semibold'>96-well qPCR plate</div><PlateMap selected={27}/></div> }
export const Compact: Story = { args: { compact: true, selected: 14 } }
