import { useEffect, useState } from 'react'

import { loadOcl } from '#/lib/chemistry-draw'
import type { Ocl } from '#/lib/chemistry-draw'

/** The chemistry library, once it has loaded (null until then). */
export function useOcl(): Ocl | null {
  const [ocl, setOcl] = useState<Ocl | null>(null)
  useEffect(() => {
    let live = true
    void loadOcl().then((loaded) => {
      if (live) setOcl(loaded)
    })
    return () => {
      live = false
    }
  }, [])
  return ocl
}
