CREATE TABLE auth_guard (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO auth_guard VALUES(1);
CREATE TABLE users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE CHECK(length(username) BETWEEN 1 AND 64),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100), password_hash text NOT NULL,
 active boolean NOT NULL DEFAULT true, is_system_admin boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE groups (id uuid PRIMARY KEY, name text NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 100));
CREATE TABLE group_members (group_id uuid REFERENCES groups ON DELETE CASCADE, user_id uuid REFERENCES users, PRIMARY KEY(group_id,user_id));
CREATE INDEX group_members_user ON group_members(user_id,group_id);
CREATE TABLE sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, token_hash text NOT NULL UNIQUE,
 csrf_token text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES users, action text NOT NULL,
 resource_type text NOT NULL, resource_id uuid, request_id text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_time ON audit_events(created_at DESC,id);
CREATE INDEX audit_resource ON audit_events(resource_type,resource_id,created_at);
CREATE TABLE login_attempts (username text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());
