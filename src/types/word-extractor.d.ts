declare module 'word-extractor' {
  interface ExtractedDocument {
    getBody: () => string
    getHeaders: (options?: { includeFooters?: boolean }) => string
    getFootnotes: () => string
    getEndnotes: () => string
  }

  export default class WordExtractor {
    extract: (input: string | Buffer) => Promise<ExtractedDocument>
  }
}
