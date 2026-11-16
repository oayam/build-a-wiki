CREATE TABLE knowledge_bases (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 owner_id uuid NOT NULL REFERENCES users, acl_version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pages (
 id uuid PRIMARY KEY, knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases,
 parent_id uuid, title text NOT NULL, created_by uuid NOT NULL REFERENCES users,
 current_revision_id uuid, acl_mode text NOT NULL DEFAULT 'inherit' CHECK(acl_mode IN('inherit','independent')),
 acl_version bigint NOT NULL DEFAULT 1, lock_version bigint NOT NULL DEFAULT 1,
 position bigint NOT NULL DEFAULT 0, deleted_at timestamptz, deletion_batch_id uuid,
 UNIQUE(id,knowledge_base_id), FOREIGN KEY(parent_id,knowledge_base_id) REFERENCES pages(id,knowledge_base_id), CHECK(parent_id IS DISTINCT FROM id)
);
CREATE INDEX pages_tree ON pages(knowledge_base_id,parent_id,position,id) WHERE deleted_at IS NULL;
CREATE TABLE page_revisions (
 id uuid PRIMARY KEY, page_id uuid NOT NULL REFERENCES pages DEFERRABLE INITIALLY DEFERRED,
 revision_no bigint NOT NULL CHECK(revision_no>0),title text NOT NULL,
 schema_version integer NOT NULL CHECK(schema_version=1),body_json jsonb NOT NULL,body_text text NOT NULL,
 editor_id uuid NOT NULL REFERENCES users,summary text NOT NULL DEFAULT '',restored_from_revision_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(page_id,revision_no),UNIQUE(page_id,id),
 FOREIGN KEY(page_id,restored_from_revision_id) REFERENCES page_revisions(page_id,id)
);
ALTER TABLE pages ADD CONSTRAINT pages_current_revision_fk FOREIGN KEY(id,current_revision_id) REFERENCES page_revisions(page_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION require_current_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM pages WHERE id=NEW.id AND current_revision_id IS NULL) THEN RAISE EXCEPTION 'page requires current revision' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER page_has_revision AFTER INSERT OR UPDATE ON pages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_current_revision();
CREATE FUNCTION immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'revisions are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER revision_no_update BEFORE UPDATE OR DELETE ON page_revisions FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE knowledge_base_acl (
 id uuid PRIMARY KEY,knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases ON DELETE CASCADE,
 user_id uuid REFERENCES users,group_id uuid REFERENCES groups ON DELETE CASCADE,
 role smallint NOT NULL CHECK(role BETWEEN 1 AND 3),CHECK(num_nonnulls(user_id,group_id)=1)
);
CREATE UNIQUE INDEX kb_acl_user ON knowledge_base_acl(knowledge_base_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX kb_acl_group ON knowledge_base_acl(knowledge_base_id,group_id) WHERE group_id IS NOT NULL;
CREATE TABLE page_acl (
 id uuid PRIMARY KEY,page_id uuid NOT NULL REFERENCES pages ON DELETE CASCADE,
 user_id uuid REFERENCES users,group_id uuid REFERENCES groups ON DELETE CASCADE,
 role smallint NOT NULL CHECK(role BETWEEN 1 AND 3),CHECK(num_nonnulls(user_id,group_id)=1)
);
CREATE UNIQUE INDEX page_acl_user ON page_acl(page_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX page_acl_group ON page_acl(page_id,group_id) WHERE group_id IS NOT NULL;
CREATE INDEX kb_acl_subject ON knowledge_base_acl(user_id,group_id,knowledge_base_id);
CREATE INDEX page_acl_subject ON page_acl(user_id,group_id,page_id);
CREATE FUNCTION kb_role(actor uuid,kb uuid) RETURNS smallint LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN NOT u.active THEN 0 WHEN u.is_system_admin OR k.owner_id=u.id THEN 3 ELSE COALESCE((
 SELECT max(a.role) FROM knowledge_base_acl a WHERE a.knowledge_base_id=k.id AND (a.user_id=u.id OR a.group_id IN(SELECT group_id FROM group_members WHERE user_id=u.id))
 ),0) END::smallint FROM users u CROSS JOIN knowledge_bases k WHERE u.id=actor AND k.id=kb
$$;
CREATE FUNCTION page_role(actor uuid,page uuid) RETURNS smallint LANGUAGE sql STABLE AS $$
 WITH RECURSIVE ancestry AS (
 SELECT id,parent_id,acl_mode,0 depth FROM pages WHERE id=page AND deleted_at IS NULL
 UNION ALL SELECT p.id,p.parent_id,p.acl_mode,a.depth+1 FROM pages p JOIN ancestry a ON p.id=a.parent_id WHERE a.depth<64
 ),boundary AS (SELECT id FROM ancestry WHERE acl_mode='independent' ORDER BY depth LIMIT 1)
 SELECT CASE WHEN NOT u.active THEN 0 WHEN u.is_system_admin OR k.owner_id=u.id THEN 3
 WHEN EXISTS(SELECT 1 FROM boundary) THEN COALESCE((SELECT max(a.role) FROM page_acl a WHERE a.page_id=(SELECT id FROM boundary) AND (a.user_id=u.id OR a.group_id IN(SELECT group_id FROM group_members WHERE user_id=u.id))),0)
 ELSE kb_role(actor,k.id) END::smallint FROM users u CROSS JOIN pages p JOIN knowledge_bases k ON k.id=p.knowledge_base_id WHERE u.id=actor AND p.id=page AND p.deleted_at IS NULL
$$;
