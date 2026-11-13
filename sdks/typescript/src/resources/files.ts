/**
 * Files: put a file into a project, add a version, read it back.
 *
 * Needs a personal token holding `files:write` (to upload) or `files:read`
 * (to download). The file is stored as the person the token belongs to, with
 * their access to the project. A workspace service credential cannot upload.
 */
import type { HttpTransport } from "../http.js";

export type FileSource = Uint8Array<ArrayBuffer> | string;

export interface StoredFile {
  fileRecordId: string;
  fileIdentifier?: string;
  byteSize: string;
  checksum: string;
  status: string;
}

const MEDIA_TYPES: Record<string, string> = {
  csv: "text/csv",
  txt: "text/plain",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mediaTypeFor(name: string, given?: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return given ?? MEDIA_TYPES[ext] ?? "application/octet-stream";
}

/** Text is sent as UTF-8; bytes as they are. */
function toBytes(source: FileSource): Uint8Array<ArrayBuffer> {
  return typeof source === "string" ? new TextEncoder().encode(source) : source;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class FilesResource {
  constructor(private transport: HttpTransport) {}

  /** Upload a new file to a project. Returns the stored file. */
  async upload(
    projectId: string,
    source: FileSource,
    options: { name: string; mediaType?: string },
  ): Promise<StoredFile & { uploadUrl: string }> {
    const bytes = toBytes(source);
    const slot = await this.transport.post("/api/files/upload-authorize", {
      jsonBody: {
        projectId,
        displayName: options.name,
        mediaType: mediaTypeFor(options.name, options.mediaType),
        byteSize: bytes.byteLength,
        checksum: await sha256Hex(bytes),
      },
    });
    const stored = await this.transport.request("PUT", slot.uploadUrl, {
      body: bytes,
      headers: { "Content-Type": "application/octet-stream" },
    });
    return { ...slot, ...stored };
  }

  /** Add a new version to an existing file. */
  async uploadVersion(
    fileRecordId: string,
    source: FileSource,
    options?: { name?: string; mediaType?: string },
  ): Promise<{ fileRecordId: string; version: number; byteSize: string; checksum: string }> {
    return this.transport.request("PUT", `/api/files/${fileRecordId}/version`, {
      params: { name: options?.name },
      body: toBytes(source),
      headers: { "Content-Type": mediaTypeFor(options?.name ?? "", options?.mediaType) },
    });
  }

  /** The bytes of the newest version, or of an earlier one. */
  async download(fileRecordId: string, options?: { version?: number }): Promise<Uint8Array> {
    return this.transport.request("GET", `/api/files/${fileRecordId}/download`, {
      params: { version: options?.version },
      raw: true,
    });
  }

  /** The file's details (name, type, size, checksum, status), newest version. */
  async get(fileRecordId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.transport.get("/api/db/file_objects", {
      params: { record_id: `eq.${fileRecordId}`, order: "version.desc", limit: 1 },
    });
    return rows[0] ?? null;
  }
}
