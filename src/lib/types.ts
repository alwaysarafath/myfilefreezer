export type FileKind = "photo" | "video" | "other";
export type FileStatus = "uploading" | "archived" | "failed";

export type FileRow = {
  id: string;
  s3_bucket: string;
  s3_key: string;
  storage_class: string;
  original_name: string;
  content_type: string | null;
  file_kind: FileKind;
  size_bytes: number;
  status: FileStatus;
  upload_id: string | null;
  created_at: string;
  archived_at: string | null;
  etag: string | null;
  checksum_sha256: string | null;
  verified_at: string | null;
  safe_to_delete: boolean;
};

export type KindTotal = {
  file_kind: FileKind;
  file_count: number;
  total_bytes: number;
};

/** Response from POST /api/uploads/create */
export type CreateUploadResponse = {
  fileId: string;
  key: string;
  uploadId: string;
  partSize: number;
  partCount: number;
};
