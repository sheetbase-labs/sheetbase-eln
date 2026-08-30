import { cn } from '#/lib/utils'

const colours = ['bg-blue-200 dark:bg-blue-800','bg-blue-300 dark:bg-blue-700','bg-blue-400 dark:bg-blue-600','bg-indigo-300 dark:bg-indigo-700','bg-slate-200 dark:bg-slate-700']
export function PlateMap({ selected=14, compact=false }: { selected?:number; compact?:boolean }) { return <div className='grid grid-cols-12 gap-1' aria-label='96 well plate'>{Array.from({length:96}).map((_,i)=><button key={i} title={`Well ${String.fromCharCode(65+Math.floor(i/12))}${(i%12)+1}`} className={cn('aspect-square rounded-[3px] border border-white/60 transition-transform hover:scale-110 dark:border-black/20',colours[(i*7+i%5)%colours.length],i===selected&&'ring-2 ring-primary ring-offset-1',compact?'min-w-2':'min-w-4')}/>)}</div> }
