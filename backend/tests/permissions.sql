CREATE TABLE auth_guard(id int PRIMARY KEY CHECK(id=1)); INSERT INTO auth_guard VALUES(1);
CREATE TABLE actors(id text PRIMARY KEY,active boolean NOT NULL,admin boolean NOT NULL);
CREATE TABLE groups(id text PRIMARY KEY);
CREATE TABLE members(group_id text REFERENCES groups,user_id text REFERENCES actors,PRIMARY KEY(group_id,user_id));
CREATE TABLE kb(id text PRIMARY KEY,owner_id text REFERENCES actors);
CREATE TABLE pages(id text PRIMARY KEY,kb_id text REFERENCES kb,parent_id text REFERENCES pages,independent boolean NOT NULL,body text NOT NULL DEFAULT 'initial');
CREATE TABLE acl(kb_id text REFERENCES kb,page_id text REFERENCES pages,user_id text REFERENCES actors,group_id text REFERENCES groups,role int CHECK(role BETWEEN 1 AND 3),CHECK(num_nonnulls(kb_id,page_id)=1),CHECK(num_nonnulls(user_id,group_id)=1));
INSERT INTO actors VALUES('owner',true,false),('editor',true,false),('reader',true,false),('none',true,false),('member',true,false),('admin',true,true),('disabled',false,true);
INSERT INTO groups VALUES('team'); INSERT INTO members VALUES('team','member');
INSERT INTO kb VALUES('k','owner');
INSERT INTO pages(id,kb_id,parent_id,independent) VALUES('root','k',null,false),('child','k','root',false),('private','k','child',true),('leaf','k','private',false);
INSERT INTO acl VALUES('k',null,'editor',null,2),('k',null,'reader',null,1),('k',null,null,'team',2),(null,'private','none',null,1);
CREATE FUNCTION effective_role(actor text,page text) RETURNS int LANGUAGE sql STABLE AS $$
WITH RECURSIVE ancestry AS (
 SELECT id,parent_id,independent,0 AS depth FROM pages WHERE id=page
 UNION ALL SELECT p.id,p.parent_id,p.independent,a.depth+1 FROM pages p JOIN ancestry a ON p.id=a.parent_id WHERE a.depth<64
), boundary AS (SELECT id FROM ancestry WHERE independent ORDER BY depth LIMIT 1),
subject AS (SELECT * FROM actors WHERE id=actor), resource AS (SELECT k.owner_id,k.id FROM kb k JOIN pages p ON p.kb_id=k.id WHERE p.id=page)
SELECT CASE WHEN NOT s.active THEN 0 WHEN s.admin OR r.owner_id=s.id THEN 3 ELSE COALESCE((
 SELECT max(a.role) FROM acl a WHERE
 ((EXISTS(SELECT 1 FROM boundary) AND a.page_id=(SELECT id FROM boundary)) OR (NOT EXISTS(SELECT 1 FROM boundary) AND a.kb_id=r.id))
 AND (a.user_id=s.id OR a.group_id IN(SELECT group_id FROM members WHERE user_id=s.id))
),0) END FROM subject s CROSS JOIN resource r
$$;
