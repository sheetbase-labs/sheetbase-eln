import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { AuditTrail } from '#/components/sheetbase/audit-trail'

const meta = { title: 'Scientific/Audit trail', component: AuditTrail, tags: ['autodocs'] } satisfies Meta<typeof AuditTrail>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = { render: () => <div className='w-[420px] rounded-lg border p-5'><AuditTrail/></div> }
