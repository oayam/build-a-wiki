-- The v1 projection is part of the history contract. Preserve empty paragraphs,
-- inline formatting boundaries, hard breaks and document order.
CREATE FUNCTION revision_text_v1(body jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    WITH RECURSIVE blocks(node, path) AS (
        SELECT body, ARRAY[]::bigint[]
        UNION ALL
        SELECT child.node, blocks.path || child.pos
        FROM blocks
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN blocks.node->>'type' IN ('paragraph', 'heading', 'codeBlock')
                 THEN '[]'::jsonb ELSE blocks.node->'content' END
        ) WITH ORDINALITY AS child(node, pos)
    )
    SELECT coalesce(string_agg(coalesce((
        SELECT string_agg(CASE WHEN part.node->>'type' = 'hardBreak' THEN E'\n'
                               ELSE part.node->>'text' END, '' ORDER BY part.pos)
        FROM jsonb_array_elements(blocks.node->'content') WITH ORDINALITY AS part(node, pos)
    ), ''), E'\n' ORDER BY path), '')
    FROM blocks WHERE node->>'type' IN ('paragraph', 'heading', 'codeBlock')
$$;

ALTER TABLE pages ADD COLUMN body_text text NOT NULL DEFAULT '';
-- Keep writers out between verification, backfill and removal of the old column.
LOCK TABLE page_revisions IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE mismatch uuid;
BEGIN
    SELECT id INTO mismatch FROM page_revisions
    WHERE body_text IS DISTINCT FROM revision_text_v1(body_json) LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Cannot reproduce plain text for revision %', mismatch;
    END IF;
END $$;
UPDATE pages p SET body_text = r.body_text
FROM page_revisions r WHERE r.id = p.current_revision_id AND r.body_text <> '';
ALTER TABLE page_revisions DROP COLUMN body_text;
