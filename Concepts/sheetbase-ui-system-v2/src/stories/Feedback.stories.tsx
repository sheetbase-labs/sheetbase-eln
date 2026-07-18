import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { AlertCircle, CheckCircle2, Database } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Empty, EmptyActions, EmptyDescription, EmptyIcon, EmptyTitle } from '#/components/ui/empty'
import { Progress } from '#/components/ui/progress'
import { Skeleton } from '#/components/ui/skeleton'
import { Spinner } from '#/components/ui/spinner'

const meta = { title: 'UI/Feedback & states', tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Alerts: Story = { render: () => <div className='grid max-w-2xl gap-3'><Alert><AlertCircle/><AlertTitle>Review required</AlertTitle><AlertDescription>This experiment has three unresolved comments.</AlertDescription></Alert><Alert variant='success'><CheckCircle2/><AlertTitle>All checks passed</AlertTitle><AlertDescription>The notebook is ready for approval.</AlertDescription></Alert><Alert variant='destructive'><AlertCircle/><AlertTitle>Import failed</AlertTitle><AlertDescription>Two required columns were missing.</AlertDescription></Alert></div> }
export const Loading: Story = { render: () => <div className='grid w-[420px] gap-4'><div className='flex items-center gap-2 text-sm'><Spinner/>Loading dataset…</div><Progress value={64}/><div className='space-y-2'><Skeleton className='h-4 w-2/3'/><Skeleton className='h-4 w-full'/><Skeleton className='h-4 w-5/6'/></div></div> }
export const EmptyState: Story = { render: () => <Empty className='w-[520px]'><EmptyIcon><Database/></EmptyIcon><EmptyTitle>No datasets linked</EmptyTitle><EmptyDescription>Attach an existing dataset or upload instrument output to begin analysis.</EmptyDescription><EmptyActions><Button size='sm'>Attach dataset</Button><Button size='sm' variant='outline'>Upload file</Button></EmptyActions></Empty> }
