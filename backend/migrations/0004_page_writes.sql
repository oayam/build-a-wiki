ALTER TABLE pages ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE request_results (
 user_id uuid NOT NULL REFERENCES users,scope text NOT NULL,request_id uuid NOT NULL,
 request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,scope,request_id)
);
CREATE INDEX page_revisions_editor ON page_revisions(editor_id,page_id);
CREATE INDEX pages_creator ON pages(created_by,knowledge_base_id);
