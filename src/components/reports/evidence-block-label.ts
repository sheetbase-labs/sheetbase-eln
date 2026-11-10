import { BLOCK_PICKER_OPTIONS } from '#/lib/blocks/registry'

/** A block's display name, as the block picker lists it; the raw type otherwise. */
export function blockLabel(type: string): string {
  return BLOCK_PICKER_OPTIONS.find((o) => o.type === type)?.label ?? type
}
