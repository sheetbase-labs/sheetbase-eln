// Sheetbase icon set: 16px grid, 1.4px stroke, current colour. Ported from the design system (Icon card).
import type { SVGProps } from 'react'
import { cn } from '#/lib/utils'

const paths = {
  home: (
    <>
      <path d="M2.5 7L8 2.5 13.5 7v6.5h-11z" />
    </>
  ),
  inbox: (
    <>
      <path d="M2 9h3.5l1 2h3l1-2H14M2 9l2-5.5h8L14 9v4.5H2z" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 7h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  folder: (
    <>
      <path d="M2 4.5h4.5l1.5 1.5h6v7.5H2z" />
    </>
  ),
  flask: (
    <>
      <path d="M6 2v4.5L2.5 13.5h11L10 6.5V2M5 2h6" />
    </>
  ),
  protocol: (
    <>
      <path d="M4 2h5.5L12 4.5V14H4z" />
      <path d="M6 7.5h4M6 10h4" />
    </>
  ),
  tube: (
    <>
      <rect x="4" y="2" width="8" height="12" rx="2" />
      <path d="M4 9h8" />
    </>
  ),
  box: (
    <>
      <path d="M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11z" />
      <path d="M2.5 5L8 7.5 13.5 5M8 7.5v6" />
    </>
  ),
  table: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M2 10h12M6 2.5v11" />
    </>
  ),
  chart: (
    <>
      <path d="M2 13.5h12M4 11l3-4 2.5 2L13 4" />
    </>
  ),
  schema: (
    <>
      <path d="M3 3.5h10M3 8h10M3 12.5h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  plus: (
    <>
      <path d="M8 3v10M3 8h10" />
    </>
  ),
  check: (
    <>
      <path d="M3 8.5l3 3 7-7" />
    </>
  ),
  x: (
    <>
      <path d="M4 4l8 8M12 4l-8 8" />
    </>
  ),
  chevronDown: (
    <>
      <path d="M4.5 6.5L8 10l3.5-3.5" />
    </>
  ),
  chevronRight: (
    <>
      <path d="M6.5 4.5L10 8l-3.5 3.5" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M13 8H3M7 4L3 8l4 4" />
    </>
  ),
  bell: (
    <>
      <path d="M4 11V7a4 4 0 018 0v4l1 1.5H3L4 11zM6.5 14h3" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </>
  ),
  moon: (
    <>
      <path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M6 14h4M8 11v3" />
    </>
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r=".8" />
      <circle cx="8" cy="8" r=".8" />
      <circle cx="12.5" cy="8" r=".8" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
      <path d="M11 5V3.5A1 1 0 0010 2.5H3.5a1 1 0 00-1 1V10a1 1 0 001 1H5" />
    </>
  ),
  link: (
    <>
      <path d="M7 9a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.8.8M9 7a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.8-.8" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11" />
    </>
  ),
  upload: (
    <>
      <path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M2.5 13.5h11" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </>
  ),
  filter: (
    <>
      <path d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" />
    </>
  ),
  scan: (
    <>
      <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M5 8h6" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c.7-2.3 2.7-3.5 5-3.5s4.3 1.2 5 3.5" />
    </>
  ),
  signOut: (
    <>
      <path d="M9.5 3H3v10h6.5M7 8h7M11.5 5.5L14 8l-2.5 2.5" />
    </>
  ),
  edit: (
    <>
      <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
    </>
  ),
  comment: (
    <>
      <path d="M3 3h10v7H7l-3 3v-3H3z" />
    </>
  ),
  warn: (
    <>
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.5v3M8 11.2v.3" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.2v3.6M8 5.2v.3" />
    </>
  ),
  pipeline: (
    <>
      <circle cx="3.5" cy="4" r="1.6" />
      <circle cx="12.5" cy="12" r="1.6" />
      <path d="M5.1 4H8a2 2 0 012 2v4a2 2 0 002 2" />
      <path d="M3.5 5.6V12h7.4" />
    </>
  ),
  play: (
    <>
      <path d="M5 3.5l7 4.5-7 4.5z" />
    </>
  ),
  code: (
    <>
      <path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" />
    </>
  ),
  webhook: (
    <>
      <circle cx="8" cy="4" r="1.8" />
      <circle cx="3.8" cy="11.5" r="1.8" />
      <circle cx="12.2" cy="11.5" r="1.8" />
      <path d="M7 5.6L4.8 9.8M9 5.6l2.2 4.2M5.6 11.5h4.8" />
    </>
  ),
  database: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="1.8" />
      <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
    </>
  ),
  pause: (
    <>
      <path d="M5.5 3.5v9M10.5 3.5v9" />
    </>
  ),
  template: (
    <>
      <path d="M3.5 2h6L12.5 5v9h-9z" />
      <path d="M9.5 2v3h3M5.5 8h5M5.5 10.5h3" />
    </>
  ),
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="2.5" />
      <path d="M7.3 8.7L13 3M11 5l1.5 1.5M9.5 6.5L11 8" />
    </>
  ),
  plug: (
    <>
      <path d="M5.5 2v3M10.5 2v3M3.5 5h9v2.5a4.5 4.5 0 01-9 0zM8 12v2.5" />
    </>
  ),
  move: (
    <>
      <path d="M2 4.5h4.5l1.5 1.5h6v7.5H2z" />
      <path d="M6 9.5h4.5M9 8l1.5 1.5L9 11" />
    </>
  ),
  archive: (
    <>
      <rect x="2" y="3" width="12" height="3" rx="1" />
      <path d="M3 6v7.5h10V6M6.5 9h3" />
    </>
  ),
} as const

export type IconName = keyof typeof paths
export const iconNames = Object.keys(paths) as IconName[]

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.4,
  className,
  ...props
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<
  SVGProps<SVGSVGElement>,
  'name'
>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
