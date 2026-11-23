/**
 * Reports: download a generated report as Word, PDF or HTML.
 *
 * Needs a personal token holding `lab:read`. Every format is made from the
 * document stored when the report was generated, so the report's fingerprint
 * (its `output_checksum`) is the same in all three.
 */
import type { HttpTransport } from "../http.js";

export type ReportFormat = "docx" | "pdf" | "html";

export class ReportsResource {
  constructor(private readonly transport: HttpTransport) {}

  /** The bytes of a generated report (`generate_report` returns its id). */
  async download(generationId: string, options?: { format?: ReportFormat }): Promise<Uint8Array> {
    return this.transport.request("GET", `/api/export/report-generation/${generationId}`, {
      params: { format: options?.format ?? "docx" },
      raw: true,
    });
  }
}
