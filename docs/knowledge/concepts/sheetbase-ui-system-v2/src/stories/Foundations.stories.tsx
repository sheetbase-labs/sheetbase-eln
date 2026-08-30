import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = { title: 'Foundations/Design tokens', tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const swatches = [
  ['Primary','bg-primary','text-primary-foreground'],['Secondary','bg-secondary','text-secondary-foreground'],['Accent','bg-accent','text-accent-foreground'],['Muted','bg-muted','text-muted-foreground'],['Destructive','bg-destructive','text-destructive-foreground'],['Card','bg-card','text-card-foreground']
]
export const Colour: Story = { render: () => <div className='grid max-w-4xl gap-8'><div><h2 className='font-display text-2xl font-semibold'>Semantic colour tokens</h2><p className='mt-1 text-sm text-muted-foreground'>Sheetbase themes are expressed through shadcn-compatible CSS variables.</p></div><div className='grid grid-cols-3 gap-4'>{swatches.map(([label,bg,fg])=><div key={label} className={`rounded-lg border p-5 ${bg} ${fg}`}><div className='font-medium'>{label}</div><div className='mt-6 font-mono text-xs'>--{label.toLowerCase()}</div></div>)}</div></div> }
export const Typography: Story = { render: () => <div className='grid max-w-3xl gap-5'><div className='font-display text-4xl font-semibold'>Display heading</div><div className='font-display text-2xl font-semibold'>Section heading</div><div className='text-base'>Body text uses Inter for dense, readable interfaces and scientific data.</div><div className='text-sm text-muted-foreground'>Supporting text and metadata</div><div className='font-mono text-sm'>EXP-2025-0014 · 3.20E+08 TU/mL</div></div> }
export const SpacingAndRadius: Story = { render: () => <div className='grid gap-8'><div className='flex items-end gap-3'>{[1,2,3,4,6,8,10,12,16].map(n=><div key={n} className='grid justify-items-center gap-2'><div className='bg-primary/20' style={{width:n*4,height:n*4}}/><span className='font-mono text-xs'>{n*4}px</span></div>)}</div><div className='flex gap-4'>{['rounded-sm','rounded-md','rounded-lg','rounded-xl'].map((r)=><div key={r} className={`size-24 border bg-card ${r}`}/>)}</div></div> }
