import { clsx  } from 'clsx'
import type {ClassValue} from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge the Sheetbase type scale, otherwise `text-body` and
// `text-fg` look like the same utility group and one of them gets dropped.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['caption', 'label', 'body', 'prose', 'section', 'doc', 'title'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
