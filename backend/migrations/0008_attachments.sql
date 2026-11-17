CREATE TABLE attachments (
 id uuid PRIMARY KEY,page_id uuid NOT NULL REFERENCES pages,uploader_id uuid NOT NULL REFERENCES users,
 upload_id uuid NOT NULL, storage_key text NOT NULL UNIQUE, original_name text NOT NULL,
 mime_type text NOT NULL, size bigint NOT NULL DEFAULT 0, checksum text NOT NULL,
 status text NOT NULL CHECK(status IN('pending','ready')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(page_id,uploader_id,upload_id)
);
CREATE INDEX attachments_page ON attachments(page_id) WHERE status='ready';
