import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Badge } from '#/components/ui/badge'
import { Property, PropertyList } from '#/components/sheetbase/property-list'

const meta = { title: 'Scientific/Property list', component: PropertyList, tags: ['autodocs'] } satisfies Meta<typeof PropertyList>
export default meta
type Story = StoryObj<typeof meta>
export const ExperimentProperties: Story = { render: () => <div className='w-[360px] rounded-lg border p-4'><PropertyList><Property label='ID'>EXP-2025-0014</Property><Property label='Status'><Badge variant='success'>In progress</Badge></Property><Property label='Project'>Lentivector Stability Study</Property><Property label='Owner'>Gareth Price</Property><Property label='Created'>14 Jul 2025, 09:12</Property><Property label='Review status'><Badge variant='warning'>Under review</Badge></Property></PropertyList></div> }
