import type { SVGProps } from 'react'

import { BRAND_MARK_SPOKES } from './brand-mark-spokes'

/**
 * The Sheetbase mark. It is drawn in the surrounding text colour, so it follows
 * the light and dark themes. Decorative by default; pass a title through
 * `aria-label` where it stands alone.
 */
export function BrandMark({
  size = 20,
  ...props
}: { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 2000 2000"
      fill="currentColor"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <path d={BRAND_MARK_SPOKES.join('')} />
    </svg>
  )
}
