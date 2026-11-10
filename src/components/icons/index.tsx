import { HugeiconsIcon } from '@hugeicons/react'
import type * as React from 'react'

import { cn } from '#/lib/utils'
import { ICONS } from './icon-map'
import type { IconName } from './icon-map'

export { ICON_NAMES, ICONS } from './icon-map'

export type { IconName } from './icon-map'

/**
 * The icon component: renders one of the app's icons (chosen by name in the
 * map module) at 16px by default, with a 1.5px stroke and the text colour.
 */
export interface IconProps extends Omit<
  React.SVGProps<SVGSVGElement>,
  'ref' | 'name'
> {
  name: IconName
  size?: number
  strokeWidth?: number
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
  className,
  ...props
}: IconProps) {
  return (
    <HugeiconsIcon
      icon={ICONS[name]}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...props}
    />
  )
}
