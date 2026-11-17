CREATE TABLE recent_visits (
 user_id uuid NOT NULL REFERENCES users,page_id uuid NOT NULL REFERENCES pages,
 visited_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,page_id)
);
CREATE INDEX recent_visits_order ON recent_visits(user_id,visited_at DESC,page_id);
