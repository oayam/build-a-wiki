-- Measured 100k-page search showed repeated ancestry traversal dominates CPU.
-- Persist only the nearest independent ACL boundary, never a user's permission result.
ALTER TABLE pages ADD COLUMN permission_boundary_id uuid REFERENCES pages DEFERRABLE INITIALLY DEFERRED;
WITH RECURSIVE tree AS (
 SELECT id,CASE WHEN acl_mode='independent' THEN id ELSE NULL::uuid END boundary FROM pages WHERE parent_id IS NULL
 UNION ALL SELECT p.id,CASE WHEN p.acl_mode='independent' THEN p.id ELSE t.boundary END FROM pages p JOIN tree t ON p.parent_id=t.id
) UPDATE pages p SET permission_boundary_id=t.boundary FROM tree t WHERE p.id=t.id;
CREATE INDEX pages_permission_boundary ON pages(permission_boundary_id,knowledge_base_id) WHERE deleted_at IS NULL;
CREATE FUNCTION initialize_permission_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.permission_boundary_id=CASE WHEN NEW.acl_mode='independent' THEN NEW.id ELSE (SELECT permission_boundary_id FROM pages WHERE id=NEW.parent_id) END;
 RETURN NEW;
END $$;
CREATE TRIGGER page_boundary_insert BEFORE INSERT ON pages FOR EACH ROW EXECUTE FUNCTION initialize_permission_boundary();
CREATE FUNCTION propagate_permission_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id AND NEW.acl_mode=OLD.acl_mode THEN RETURN NULL; END IF;
 WITH RECURSIVE tree AS(
 SELECT p.id,CASE WHEN p.acl_mode='independent' THEN p.id ELSE parent.permission_boundary_id END boundary FROM pages p LEFT JOIN pages parent ON parent.id=p.parent_id WHERE p.id=NEW.id
 UNION ALL SELECT p.id,CASE WHEN p.acl_mode='independent' THEN p.id ELSE t.boundary END FROM pages p JOIN tree t ON p.parent_id=t.id
 ) UPDATE pages p SET permission_boundary_id=t.boundary FROM tree t WHERE p.id=t.id AND p.permission_boundary_id IS DISTINCT FROM t.boundary;
 RETURN NULL;
END $$;
CREATE TRIGGER page_boundary_change AFTER UPDATE OF parent_id,acl_mode ON pages FOR EACH ROW EXECUTE FUNCTION propagate_permission_boundary();
CREATE OR REPLACE FUNCTION archived_page_role(actor uuid,page uuid) RETURNS smallint LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN NOT u.active THEN 0 WHEN u.is_system_admin OR k.owner_id=u.id THEN 3
 WHEN p.permission_boundary_id IS NOT NULL THEN COALESCE((SELECT max(a.role) FROM page_acl a WHERE a.page_id=p.permission_boundary_id AND (a.user_id=u.id OR a.group_id IN(SELECT group_id FROM group_members WHERE user_id=u.id))),0)
 ELSE kb_role(actor,k.id) END::smallint FROM users u CROSS JOIN pages p JOIN knowledge_bases k ON k.id=p.knowledge_base_id WHERE u.id=actor AND p.id=page
$$;
CREATE OR REPLACE FUNCTION page_role(actor uuid,page uuid) RETURNS smallint LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN p.deleted_at IS NULL THEN archived_page_role(actor,page) ELSE 0 END::smallint FROM pages p WHERE p.id=page
$$;
CREATE OR REPLACE FUNCTION page_access(actor uuid) RETURNS TABLE(id uuid,role smallint) LANGUAGE sql STABLE AS $$
 WITH who AS MATERIALIZED(SELECT id,is_system_admin FROM users WHERE id=actor AND active),
 memberships AS MATERIALIZED(SELECT group_id FROM group_members WHERE user_id=actor),
 ka AS MATERIALIZED(SELECT knowledge_base_id,max(role) role FROM knowledge_base_acl WHERE user_id=actor OR group_id IN(SELECT group_id FROM memberships) GROUP BY knowledge_base_id),
 pa AS MATERIALIZED(SELECT page_id,max(role) role FROM page_acl WHERE user_id=actor OR group_id IN(SELECT group_id FROM memberships) GROUP BY page_id)
 SELECT p.id,CASE WHEN w.is_system_admin OR k.owner_id=w.id THEN 3 WHEN p.permission_boundary_id IS NOT NULL THEN COALESCE(pa.role,0) ELSE COALESCE(ka.role,0) END::smallint role
 FROM pages p JOIN knowledge_bases k ON k.id=p.knowledge_base_id CROSS JOIN who w LEFT JOIN pa ON pa.page_id=p.permission_boundary_id LEFT JOIN ka ON ka.knowledge_base_id=k.id
 WHERE p.deleted_at IS NULL AND (w.is_system_admin OR k.owner_id=w.id OR CASE WHEN p.permission_boundary_id IS NOT NULL THEN COALESCE(pa.role,0) ELSE COALESCE(ka.role,0) END>0)
$$;
