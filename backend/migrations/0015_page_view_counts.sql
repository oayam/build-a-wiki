-- Each existing user/page row is evidence of at least one visit.
ALTER TABLE recent_visits ADD COLUMN view_count bigint NOT NULL DEFAULT 1 CHECK (view_count > 0);
CREATE INDEX recent_visits_by_page ON recent_visits(page_id);
