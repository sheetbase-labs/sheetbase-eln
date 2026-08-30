import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'

const meta = { title: 'UI/Card', component: Card, tags: ['autodocs'] } satisfies Meta<typeof Card>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = { render: () => <Card className='w-[360px]'><CardHeader><CardTitle>Experiment overview</CardTitle><CardDescription>Core metadata and scientific state.</CardDescription></CardHeader><CardContent className='space-y-2 text-sm'><div className='flex justify-between'><span className='text-muted-foreground'>Status</span><span>In progress</span></div><div className='flex justify-between'><span className='text-muted-foreground'>Owner</span><span>Gareth Price</span></div></CardContent><CardFooter><Button size='sm'>Open experiment</Button></CardFooter></Card> }
