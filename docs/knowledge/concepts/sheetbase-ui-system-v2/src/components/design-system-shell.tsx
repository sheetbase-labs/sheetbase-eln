import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Blocks, BookOpen, Boxes, Command as CommandIcon, FlaskConical, Grid2X2, Menu, Moon, PanelLeft, Search, Settings2, Sun, Workflow, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Kbd } from '#/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '#/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip'
import { useTheme } from '#/components/theme-provider'
import { cn } from '#/lib/utils'

const navigation = [
  { to: '/', label: 'Overview', icon: Grid2X2 },
  { to: '/foundations', label: 'Foundations', icon: BookOpen },
  { to: '/components', label: 'UI components', icon: Blocks },
  { to: '/scientific', label: 'Scientific components', icon: FlaskConical },
  { to: '/patterns', label: 'Product patterns', icon: Workflow },
  { to: '/templates', label: 'Page templates', icon: Boxes },
] as const

export function DesignSystemShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { theme, setTheme, density, setDensity } = useTheme()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [commandOpen, setCommandOpen] = React.useState(false)
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  const sidebar = <>
    <div className='flex h-14 items-center border-b px-3'>
      <Link to='/' className='flex items-center gap-2 text-foreground no-underline'>
        <div className='flex size-8 items-center justify-center rounded-lg bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950'><Boxes className='size-4'/></div>
        <div><p className='font-display text-sm font-semibold leading-none'>Sheetbase</p><p className='mt-1 text-[10px] text-muted-foreground'>UI system</p></div>
      </Link>
      <Button variant='ghost' size='icon-sm' className='ml-auto md:hidden' onClick={()=>setMobileOpen(false)}><X/></Button>
    </div>
    <div className='px-3 py-3'>
      <button onClick={()=>setCommandOpen(true)} className='flex h-9 w-full items-center gap-2 rounded-md border bg-background px-3 text-left text-xs text-muted-foreground shadow-xs hover:bg-muted/50'><Search className='size-3.5'/><span className='flex-1'>Search components</span><Kbd>⌘K</Kbd></button>
    </div>
    <nav className='flex-1 space-y-1 px-2'>
      <p className='px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>Library</p>
      {navigation.map((item) => { const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to); return <Link key={item.to} to={item.to} onClick={()=>setMobileOpen(false)} className={cn('flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-muted/70 hover:text-foreground',active&&'bg-accent text-accent-foreground')}><item.icon className='size-4'/><span>{item.label}</span>{item.label==='UI components'&&<Badge variant='secondary' className='ml-auto'>31</Badge>}</Link> })}
    </nav>
    <div className='border-t p-3'>
      <div className='rounded-lg border bg-muted/25 p-3'><p className='text-xs font-semibold'>Framework status</p><p className='mt-1 text-[11px] leading-4 text-muted-foreground'>TanStack Start · shadcn architecture · Radix primitives</p><div className='mt-2 flex gap-1.5'><Badge variant='success'>Stable</Badge><Badge variant='outline'>v0.1</Badge></div></div>
    </div>
  </>
  return <TooltipProvider>
    <div className='min-h-screen bg-background text-foreground'>
      <aside className='fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-sidebar md:flex'>{sidebar}</aside>
      {mobileOpen&&<div className='fixed inset-0 z-50 md:hidden'><button className='absolute inset-0 bg-black/30' onClick={()=>setMobileOpen(false)}/><aside className='relative flex h-full w-72 flex-col border-r bg-sidebar shadow-xl'>{sidebar}</aside></div>}
      <div className='md:pl-60'>
        <header className='sticky top-0 z-30 flex h-14 items-center border-b bg-background/92 px-4 backdrop-blur md:px-6'>
          <Button variant='ghost' size='icon-sm' className='mr-2 md:hidden' onClick={()=>setMobileOpen(true)}><Menu/></Button>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'><PanelLeft className='size-3.5'/><span>Design system</span><span>/</span><span className='font-medium text-foreground'>{navigation.find((n)=>n.to==='/'?pathname==='/':pathname.startsWith(n.to))?.label ?? 'Page'}</span></div>
          <div className='ml-auto flex items-center gap-1.5'>
            <Select value={density} onValueChange={(value)=>setDensity(value as 'comfortable'|'compact')}><SelectTrigger className='hidden h-8 w-32 text-xs sm:flex'><Settings2 className='mr-1 size-3.5'/><SelectValue/></SelectTrigger><SelectContent><SelectItem value='comfortable'>Comfortable</SelectItem><SelectItem value='compact'>Compact</SelectItem></SelectContent></Select>
            <Tooltip><TooltipTrigger asChild><Button variant='ghost' size='icon-sm' onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun/>:<Moon/>}</Button></TooltipTrigger><TooltipContent>Toggle theme</TooltipContent></Tooltip>
            <Button size='sm' className='hidden sm:inline-flex' onClick={()=>setCommandOpen(true)}><CommandIcon/>Command</Button>
          </div>
        </header>
        <main className='mx-auto w-full max-w-[1280px] px-4 py-7 md:px-8'>{children}</main>
      </div>
      <Dialog open={commandOpen} onOpenChange={setCommandOpen}><DialogContent className='max-w-xl overflow-hidden p-0'><DialogTitle className='sr-only'>Search design system</DialogTitle><Command><CommandInput placeholder='Search components, tokens and patterns…'/><CommandList><CommandEmpty>No results found.</CommandEmpty><CommandGroup heading='Navigate'>{navigation.map((item)=><CommandItem key={item.to} value={item.label} onSelect={()=>{window.location.href=item.to;setCommandOpen(false)}}><item.icon/>{item.label}<CommandShortcut>Open</CommandShortcut></CommandItem>)}</CommandGroup><CommandGroup heading='Actions'><CommandItem onSelect={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun/>:<Moon/>}Toggle colour mode</CommandItem><CommandItem onSelect={()=>setDensity(density==='compact'?'comfortable':'compact')}><Settings2/>Toggle density</CommandItem></CommandGroup></CommandList></Command></DialogContent></Dialog>
    </div>
  </TooltipProvider>
}
