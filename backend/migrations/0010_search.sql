CREATE INDEX pages_updated ON pages(updated_at DESC,id DESC) WHERE deleted_at IS NULL;
