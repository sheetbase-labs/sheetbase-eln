export declare const CONVENTIONAL_TYPES: string[]
export declare const CONVENTIONAL_SUBJECT: RegExp
export declare function isAttributionLine(line: string): boolean
export declare function stripAttribution(message: string): string
export declare function checkSubject(subject: string, what?: string): string[]
export declare function checkAttribution(text: string, what: string): string[]
export declare function checkCommit(commit: {
  message: string
  author?: string
  committer?: string
  parents?: number
}): string[]
export declare function checkPullRequest(pr: {
  title?: string
  body?: string
  head?: string
}): string[]
