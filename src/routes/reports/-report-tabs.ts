/** The three things a report page shows, and the name each has in the URL. */
export const REPORT_TABS = ['build', 'preview', 'generated'] as const

export type ReportTab = (typeof REPORT_TABS)[number]
