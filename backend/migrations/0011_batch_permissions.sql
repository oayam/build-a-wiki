-- Compute each inheritance edge once for a complete list/search query.
CREATE FUNCTION page_access(actor uuid) RETURNS TABLE(id uuid,role smallint) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE who AS MATERIALIZED(SELECT id,is_system_admin FROM users WHERE id=actor AND active),
 memberships AS MATERIALIZED(SELECT group_id FROM group_members WHERE user_id=actor),
 ka AS MATERIALIZED(SELECT knowledge_base_id,max(role) role FROM knowledge_base_acl WHERE user_id=actor OR group_id IN(SELECT group_id FROM memberships) GROUP BY knowledge_base_id),
 pa AS MATERIALIZED(SELECT page_id,max(role) role FROM page_acl WHERE user_id=actor OR group_id IN(SELECT group_id FROM memberships) GROUP BY page_id),
 nodes AS MATERIALIZED(SELECT p.id,p.parent_id,p.deleted_at,
 CASE WHEN w.is_system_admin OR k.owner_id=w.id THEN 3 WHEN p.acl_mode='independent' THEN COALESCE(pa.role,0) ELSE NULL END::smallint boundary_role,
 CASE WHEN w.is_system_admin OR k.owner_id=w.id THEN 3 ELSE COALESCE(ka.role,0) END::smallint root_role
 FROM pages p JOIN knowledge_bases k ON k.id=p.knowledge_base_id CROSS JOIN who w LEFT JOIN pa ON pa.page_id=p.id LEFT JOIN ka ON ka.knowledge_base_id=k.id),
 tree AS(SELECT n.id,n.deleted_at,COALESCE(n.boundary_role,n.root_role)::smallint role,1 depth FROM nodes n WHERE n.parent_id IS NULL
 UNION ALL SELECT n.id,n.deleted_at,COALESCE(n.boundary_role,t.role)::smallint,t.depth+1 FROM nodes n JOIN tree t ON n.parent_id=t.id WHERE t.depth<64)
 SELECT t.id,t.role FROM tree t WHERE t.deleted_at IS NULL AND t.role>0
$$;
