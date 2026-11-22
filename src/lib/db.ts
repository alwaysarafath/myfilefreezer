import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { FileKind, FileRow, FileStatus, KindTotal } from "./types";

/**
 * The index over your bucket.
 *
 * This database is a cache, not the source of truth -- S3 holds the files, and this table
 * only makes them listable without paging the whole bucket on every page load. Delete it
 * and `npm run reindex` rebuilds it from S3. That property is worth preserving: never put
 * anything in here that cannot be recovered from the bucket.
 */

const SCHEMA = `
create table if not exists files (
  id              text primary key,
  s3_bucket       text not null,
  s3_key          text not null unique,
  storage_class   text not null default 'DEEP_ARCHIVE',
  original_name   text not null,
  content_type    text,
  file_kind       text not null,
  size_bytes      integer not null,
  status          text not null default 'uploading',
  upload_id       text,
  created_at      text not null,
  archived_at     text,
  etag            text,
  checksum_sha256 text,
  verified_at     text,
  safe_to_delete  integer not null default 0
);
create index if not exists files_created_idx on files (created_at desc);
create index if not exists files_status_idx  on files (status);
`;

let database: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (database) return database;

  // The DB path is runtime config, not a build input -- keep the bundler from tracing it.
  const path = resolve(/*turbopackIgnore: true*/ process.env.DB_PATH ?? "./data/myfilefreezer.db");
  mkdirSync(dirname(path), { recursive: true });

  database = new DatabaseSync(path);
  // WAL keeps a long-running upload's writes from blocking a page load.
  database.exec("pragma journal_mode = WAL");
  database.exec("pragma foreign_keys = ON");
  database.exec(SCHEMA);
  return database;
}

type RawRow = Omit<FileRow, "safe_to_delete"> & { safe_to_delete: number };

function hydrate(row: RawRow): FileRow {
  return { ...row, safe_to_delete: row.safe_to_delete === 1 };
}

export function insertFile(input: {
  id: string;
  bucket: string;
  key: string;
  name: string;
  contentType: string | null;
  kind: FileKind;
  size: number;
}): void {
  db()
    .prepare(
      `insert into files (id, s3_bucket, s3_key, original_name, content_type, file_kind, size_bytes, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.bucket,
      input.key,
      input.name,
      input.contentType,
      input.kind,
      input.size,
      new Date().toISOString(),
    );
}

export function setUploadId(id: string, uploadId: string): void {
  db().prepare(`update files set upload_id = ? where id = ?`).run(uploadId, id);
}

export function markArchived(
  id: string,
  fields: { etag: string | null; checksum: string | null },
): void {
  const now = new Date().toISOString();
  db()
    .prepare(
      `update files
          set status = 'archived', archived_at = ?, verified_at = ?, safe_to_delete = 1,
              upload_id = null, etag = ?, checksum_sha256 = ?
        where id = ?`,
    )
    .run(now, now, fields.etag, fields.checksum, id);
}

export function markFailed(id: string): void {
  db()
    .prepare(
      `update files set status = 'failed', safe_to_delete = 0, upload_id = null where id = ?`,
    )
    .run(id);
}

export function getFile(id: string): FileRow | null {
  const row = db().prepare(`select * from files where id = ?`).get(id) as RawRow | undefined;
  return row ? hydrate(row) : null;
}

export function listFiles(limit = 1000): FileRow[] {
  const rows = db()
    .prepare(
      `select * from files where status != 'failed' order by created_at desc limit ?`,
    )
    .all(limit) as RawRow[];
  return rows.map(hydrate);
}

export function listArchived(): FileRow[] {
  const rows = db()
    .prepare(`select * from files where status = 'archived' order by created_at desc`)
    .all() as RawRow[];
  return rows.map(hydrate);
}

export function totalsByKind(): KindTotal[] {
  return db()
    .prepare(
      `select file_kind, count(*) as file_count, sum(size_bytes) as total_bytes
         from files where status = 'archived'
        group by file_kind`,
    )
    .all() as KindTotal[];
}

/**
 * Bytes committed to the bucket, including uploads still in flight.
 *
 * Shown, never enforced. You pay Amazon directly, so the right spending guard is an AWS
 * billing alarm (see the README), not an app-level cap that cannot see the rest of your bill.
 */
export function usedBytes(): number {
  const row = db()
    .prepare(
      `select coalesce(sum(size_bytes), 0) as used from files where status in ('uploading','archived')`,
    )
    .get() as { used: number };
  return Number(row.used);
}

/** Used by the reindex script; upserts so a re-run is idempotent. */
export function upsertFromS3(input: {
  id: string;
  bucket: string;
  key: string;
  name: string;
  kind: FileKind;
  size: number;
  storageClass: string;
  lastModified: string;
  etag: string | null;
  status: FileStatus;
  /** Only for objects confirmed to be in DEEP_ARCHIVE -- the same bar the upload path sets. */
  safeToDelete: boolean;
}): void {
  db()
    .prepare(
      `insert into files (id, s3_bucket, s3_key, storage_class, original_name, file_kind,
                          size_bytes, status, created_at, archived_at, verified_at,
                          safe_to_delete, etag)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(s3_key) do update set
         size_bytes    = excluded.size_bytes,
         storage_class = excluded.storage_class,
         status        = excluded.status,
         etag          = excluded.etag,
         upload_id     = null,
         -- Can revoke the flag (object found outside Deep Archive), never grant it to a
         -- row the upload path had declined to verify.
         safe_to_delete = min(files.safe_to_delete, excluded.safe_to_delete)`,
    )
    .run(
      input.id,
      input.bucket,
      input.key,
      input.storageClass,
      input.name,
      input.kind,
      input.size,
      input.status,
      input.lastModified,
      input.lastModified,
      input.safeToDelete ? input.lastModified : null,
      input.safeToDelete ? 1 : 0,
      input.etag,
    );
}
