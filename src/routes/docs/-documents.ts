/**
 * Shared allowlist of runbook documents served under `/docs/$name` — used by
 * the document route (`$name.tsx`) and the `/docs` index (`index.tsx`).
 */
export const DOC_NAMES = [
  'deployment',
  'recovery',
  'security',
  'performance',
  'observability',
  'administration',
] as const

export const DOC_TITLES: Record<string, string> = {
  deployment: 'Deployment',
  recovery: 'Recovery',
  security: 'Security',
  performance: 'Performance',
  observability: 'Observability',
  administration: 'Administration',
}
