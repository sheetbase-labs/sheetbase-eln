import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Inspector } from '#/components/record/inspector'
import { PropertyList, Property } from '#/components/scientific/property-list'
import { StatusBadge } from '#/components/scientific/status-badge'
import { Badge } from '#/components/ui/badge'

const tabs = [
  { id: 'properties', label: 'Properties', content: <PropertyList><Property label="ID">EXP-2025-0014</Property><Property label="Status"><StatusBadge domain="experiment" status="in-progress" /></Property><Property label="Owner">Dr. Maya Chen</Property><Property label="Project">Vector stability</Property><Property label="Created">14 July 2025</Property><Property label="Last modified">29 July 2025</Property><Property label="Tags"><span className="flex gap-1"><Badge variant="outline">lentivirus</Badge><Badge variant="outline">stability</Badge></span></Property></PropertyList> },
  { id: 'activity', label: 'Activity', badge: 3, content: <ol className="space-y-4 text-sm"><li><b>Dr. Maya Chen</b> updated the storage condition <p className="text-xs text-muted-foreground">Today, 09:42</p></li><li><b>Alex Rivera</b> attached qPCR results <p className="text-xs text-muted-foreground">Yesterday, 16:18</p></li><li><b>System</b> recorded a new revision <p className="text-xs text-muted-foreground">25 July, 11:03</p></li></ol> },
  { id: 'comments', label: 'Comments', badge: 2, content: <div className="space-y-4"><div className="flex gap-3"><span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs">MC</span><p className="text-sm"><b>Maya Chen</b><br />Replicate two should be repeated before review.</p></div><div className="flex gap-3"><span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs">AR</span><p className="text-sm"><b>Alex Rivera</b><br />The repeat is scheduled for Friday.</p></div></div> },
]
const meta = { title: 'Record/Inspector', component: Inspector, tags: ['autodocs'], parameters: { layout: 'fullscreen' }, args: { recordType: 'Experiment', title: 'Virus Stability at 4 °C', tabs, className: 'h-[600px] w-[380px] border' } } satisfies Meta<typeof Inspector>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Loading: Story = { args: { state: 'skeleton' } }
export const NoSelection: Story = { args: { state: 'no-selection', title: 'Inspector' } }
export const Unavailable: Story = { args: { state: 'unavailable' } }
export const PermissionDenied: Story = { args: { state: 'permission-denied' } }
