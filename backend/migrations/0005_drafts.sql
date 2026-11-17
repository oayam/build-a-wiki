CREATE TABLE page_drafts (
 page_id uuid NOT NULL REFERENCES pages,user_id uuid NOT NULL REFERENCES users,
 base_revision_id uuid,title text,schema_version integer,body_json jsonb,
 draft_version bigint NOT NULL CHECK(draft_version>0),discarded boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(page_id,user_id),
 FOREIGN KEY(page_id,base_revision_id) REFERENCES page_revisions(page_id,id),
 CHECK(discarded OR (base_revision_id IS NOT NULL AND title IS NOT NULL AND schema_version=1 AND body_json IS NOT NULL))
);
