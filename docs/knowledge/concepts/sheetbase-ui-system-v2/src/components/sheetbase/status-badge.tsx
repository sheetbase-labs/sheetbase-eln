import { Badge } from '#/components/ui/badge'
import { Circle } from 'lucide-react'

const map = { draft:'secondary', planned:'info', 'in progress':'success', review:'violet', approved:'success', locked:'outline', failed:'danger', warning:'warning', archived:'outline' } as const
export function StatusBadge({ status }: { status: keyof typeof map }) { return <Badge variant={map[status]}><Circle className='size-1.5 fill-current'/>{status}</Badge> }
