CREATE TABLE deletion_batches(id uuid PRIMARY KEY,root_id uuid NOT NULL,deleted_by uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX pages_batch ON pages(deletion_batch_id) WHERE deleted_at IS NOT NULL;
CREATE FUNCTION archived_page_role(actor uuid,page uuid) RETURNS smallint LANGUAGE sql STABLE AS $$
 WITH RECURSIVE ancestry AS (
 SELECT id,parent_id,acl_mode,0 depth FROM pages WHERE id=page
 UNION ALL SELECT p.id,p.parent_id,p.acl_mode,a.depth+1 FROM pages p JOIN ancestry a ON p.id=a.parent_id WHERE a.depth<64
 ),boundary AS (SELECT id FROM ancestry WHERE acl_mode='independent' ORDER BY depth LIMIT 1)
 SELECT CASE WHEN NOT u.active THEN 0 WHEN u.is_system_admin OR k.owner_id=u.id THEN 3
 WHEN EXISTS(SELECT 1 FROM boundary) THEN COALESCE((SELECT max(a.role) FROM page_acl a WHERE a.page_id=(SELECT id FROM boundary) AND (a.user_id=u.id OR a.group_id IN(SELECT group_id FROM group_members WHERE user_id=u.id))),0)
 ELSE kb_role(actor,k.id) END::smallint FROM users u CROSS JOIN pages p JOIN knowledge_bases k ON k.id=p.knowledge_base_id WHERE u.id=actor AND p.id=page
$$;
CREATE OR REPLACE FUNCTION immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_setting('wiki.purge',true)='on' AND EXISTS(SELECT 1 FROM pages WHERE id=OLD.page_id AND deleted_at<=now()-interval '30 days') THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'revisions are immutable' USING ERRCODE='23514';
END $$;
