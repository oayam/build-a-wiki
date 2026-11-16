-- 仅工程基线；身份和业务表按 T13/T19 后续迁移添加。
CREATE TABLE app_metadata (
    key text PRIMARY KEY,
    value text NOT NULL
);
INSERT INTO app_metadata(key, value) VALUES ('schema_stage', 'foundation');
