import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Database, FileText, FlaskConical, TestTube2 } from 'lucide-react'
import { RecordLink } from '#/components/sheetbase/record-link'

const meta = { title: 'Scientific/Record link', component: RecordLink, tags: ['autodocs'] } satisfies Meta<typeof RecordLink>
export default meta
type Story = StoryObj<typeof meta>
export const Types: Story = { render: () => <div className='grid w-[420px] gap-2'><RecordLink icon={FlaskConical} title='Virus Stability at 4 °C' meta='EXP-2025-0014 · Experiment'/><RecordLink icon={TestTube2} title='LVV-256001' meta='SMP-LV-0001 · Sample'/><RecordLink icon={Database} title='Stability Raw Data' meta='DS-2025-0004 · Dataset'/><RecordLink icon={FileText} title='Lentivirus Titration SOP' meta='PRT-2025-0007 · Protocol'/></div> }
