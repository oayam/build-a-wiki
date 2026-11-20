CREATE TABLE page_edit_leases (
    page_id uuid PRIMARY KEY REFERENCES pages ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users,
    lease_id uuid NOT NULL,
    expires_at timestamptz NOT NULL
);
