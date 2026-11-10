import { ICONS } from '#/components/icons'
import type { IconName } from '#/components/icons'

function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name)
}

/** A plugin's icon name if the app has an icon by that name, otherwise the plug. */
export function pluginIcon(name: string | undefined): IconName {
  return name && isIconName(name) ? name : 'plug'
}
