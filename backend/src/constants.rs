//! Stable runtime strings shared by the API and maintenance commands.
//! Keep wire values unchanged: clients, persisted jobs and audit filters depend on them.
//! SQL, format strings and literal-only macro attributes stay at their call sites.

pub mod env {
    pub const APP_BASE_URL: &str = "APP_BASE_URL";
    pub const APP_ENV: &str = "APP_ENV";
    pub const ATTACHMENT_DIR: &str = "ATTACHMENT_DIR";
    pub const BIND_ADDR: &str = "BIND_ADDR";
    pub const DATABASE_URL: &str = "DATABASE_URL";
    pub const LOG_LEVEL: &str = "LOG_LEVEL";
    pub const SESSION_TTL: &str = "SESSION_TTL";
    pub const UPLOAD_MAX_BYTES: &str = "UPLOAD_MAX_BYTES";
}

pub mod error_code {
    pub const EDIT_LEASE: &str = "EDIT_LEASE";
    pub const ACL_CONFLICT: &str = "ACL_CONFLICT";
    pub const CONFLICT: &str = "CONFLICT";
    pub const DRAFT_CONFLICT: &str = "DRAFT_CONFLICT";
    pub const FORBIDDEN: &str = "FORBIDDEN";
    pub const IDEMPOTENCY_CONFLICT: &str = "IDEMPOTENCY_CONFLICT";
    pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
    pub const LAST_ADMIN: &str = "LAST_ADMIN";
    pub const MAINTENANCE: &str = "MAINTENANCE";
    pub const METHOD_NOT_ALLOWED: &str = "METHOD_NOT_ALLOWED";
    pub const MOVE_CONFLICT: &str = "MOVE_CONFLICT";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const NOT_READY: &str = "NOT_READY";
    pub const OWNER_TRANSFER_REQUIRED: &str = "OWNER_TRANSFER_REQUIRED";
    pub const PASSWORD_POLICY_REQUIRED: &str = "PASSWORD_POLICY_REQUIRED";
    pub const PAYLOAD_TOO_LARGE: &str = "PAYLOAD_TOO_LARGE";
    pub const RATE_LIMITED: &str = "RATE_LIMITED";
    pub const REVISION_CONFLICT: &str = "REVISION_CONFLICT";
    pub const STORAGE_UNAVAILABLE: &str = "STORAGE_UNAVAILABLE";
    pub const STRUCTURE_CONFLICT: &str = "STRUCTURE_CONFLICT";
    pub const UNAUTHENTICATED: &str = "UNAUTHENTICATED";
    pub const UPLOAD_PENDING: &str = "UPLOAD_PENDING";
    pub const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
}

pub mod message {
    pub const PAGE_BUSY: &str = "此文稿正在其他编辑窗口中打开，请稍后重试";
    pub const LEASE_LOST: &str = "编辑权已失效，请重新获取编辑权";
    pub const ACL_CONFLICT: &str = "权限已被其他管理员修改，请重新加载";
    pub const APP_BASE_URL_REQUIRED: &str = "APP_BASE_URL required";
    pub const ATTACHMENT_DIR_REQUIRED: &str = "ATTACHMENT_DIR required";
    pub const BOOTSTRAP_CLOSED: &str = "初始化已关闭";
    pub const CREATE_PAGE: &str = "创建页面";
    pub const DATABASE_CONNECTION_FAILED: &str = "database connection failed";
    pub const DATABASE_ERROR: &str = "数据库错误";
    pub const DRAFT_DELETE_CONFLICT: &str = "草稿已更新，不能丢弃其他窗口的内容";
    pub const DRAFT_WRITE_CONFLICT: &str = "草稿已在其他窗口更新，请先复制本地内容再重新加载";
    pub const FORBIDDEN: &str = "没有操作权限";
    pub const INTERNAL_ERROR: &str = "服务内部错误";
    pub const INVALID_APP_BASE_URL: &str = "invalid APP_BASE_URL";
    pub const INVALID_BATCH: &str = "invalid batch";
    pub const INVALID_BIND_ADDR: &str = "invalid BIND_ADDR";
    pub const INVALID_DATABASE_URL: &str = "DATABASE_URL must be a PostgreSQL URL";
    pub const INVALID_INPUT: &str = "输入无效";
    pub const INVALID_LOG_LEVEL: &str = "invalid LOG_LEVEL";
    pub const INVALID_ORIGIN: &str = "APP_BASE_URL must be an origin without trailing slash";
    pub const INVALID_REFERENCE: &str = "引用或输入无效";
    pub const INVALID_REQUEST: &str = "请求格式无效";
    pub const INVALID_SESSION_TTL: &str = "invalid SESSION_TTL";
    pub const INVALID_STORAGE_KEY: &str = "invalid storage key";
    pub const INVALID_UPLOAD_JOB: &str = "invalid upload job";
    pub const INVALID_UPLOAD_LIMIT: &str = "UPLOAD_MAX_BYTES must be 1..1073741824";
    pub const INVALID_USERNAME: &str = "无效用户名";
    pub const KNOWLEDGE_BASE_OWNER: &str = "知识库所有者";
    pub const KNOWLEDGE_BASE_PERMISSION: &str = "知识库授权";
    pub const LAST_ADMIN: &str = "不能停用或降级最后一个管理员";
    pub const MAINTENANCE: &str = "系统维护中，请稍后重试";
    pub const MAINTENANCE_BLOCKS_AUDIT: &str = "maintenance blocks audit writes";
    pub const METHOD_NOT_ALLOWED: &str = "请求方法不支持";
    pub const MOVE_CONFLICT: &str = "结构或权限已变化，请重新预览";
    pub const MOVE_PERMISSION_NOTICE: &str = "继承权限的页面将采用目标位置的授权；独立授权边界及其后代保持原授权。移动不改变页面网址和历史版本。";
    pub const NOT_FOUND: &str = "资源不存在";
    pub const NOT_READY: &str = "服务尚未就绪";
    pub const OWNER_TRANSFER_REQUIRED: &str = "请先转让该账号的知识库";
    pub const PAGE_IDEMPOTENCY_CONFLICT: &str = "同一请求标识不能用于不同内容";
    pub const PASSWORD_HASH_FAILED: &str = "密码处理失败";
    pub const PASSWORD_POLICY: &str = "密码至少12个字符，最多256字节";
    pub const PASSWORD_RESET_REQUIRED: &str = "请由管理员重置为至少12字符的新密码";
    pub const PAYLOAD_TOO_LARGE: &str = "文件超过上传限制";
    pub const PRODUCTION_REQUIRES_HTTPS: &str = "production requires HTTPS";
    pub const PURGE_FAILED: &str = "purge failed";
    pub const RATE_LIMITED: &str = "登录失败过多，请稍后重试";
    pub const RECORD_EXISTS: &str = "记录已存在";
    pub const REMOTE_REQUIRES_HTTPS: &str = "non-local deployment requires HTTPS";
    pub const RESTORE_CONFLICT: &str = "恢复前页面已更新，请重新查看历史";
    pub const RESTORE_REVISION: &str = "恢复历史版本";
    pub const REVISION_CONFLICT: &str = "页面已被其他成员更新，本地内容已保留";
    pub const SESSION_TTL_OUT_OF_RANGE: &str = "SESSION_TTL outside 60..604800";
    pub const STORAGE_UNAVAILABLE: &str = "附件存储不可用，请稍后重试";
    pub const STRUCTURE_CONFLICT: &str = "子树已变化，请重新预览";
    pub const SYSTEM_ADMIN: &str = "系统管理员";
    pub const UNAUTHENTICATED: &str = "请重新登录";
    pub const UNSUPPORTED_JOB: &str = "unsupported job";
    pub const UPLOAD_IDEMPOTENCY_CONFLICT: &str = "同一上传请求不能用于其他文件";
    pub const UPLOAD_PENDING: &str = "上传尚未完成，请稍后重试或重新上传";
}

pub mod audit_action {
    pub const ATTACHMENTS_ADMIN_READ: &str = "attachments.admin_read";
    pub const ATTACHMENTS_UPLOAD: &str = "attachments.upload";
    pub const AUTH_FAILED: &str = "auth.failed";
    pub const AUTH_LOGIN: &str = "auth.login";
    pub const AUTH_LOGOUT: &str = "auth.logout";
    pub const GROUPS_ADD_MEMBER: &str = "groups.add_member";
    pub const GROUPS_CREATE: &str = "groups.create";
    pub const GROUPS_REMOVE_MEMBER: &str = "groups.remove_member";
    pub const JOBS_RETRY: &str = "jobs.retry";
    pub const KNOWLEDGE_BASES_ADMIN_READ: &str = "knowledge_bases.admin_read";
    pub const KNOWLEDGE_BASES_CREATE: &str = "knowledge_bases.create";
    pub const KNOWLEDGE_BASES_RENAME: &str = "knowledge_bases.rename";
    pub const KNOWLEDGE_BASES_TRANSFER: &str = "knowledge_bases.transfer";
    pub const PAGES_ADMIN_READ: &str = "pages.admin_read";
    pub const PAGES_CREATE: &str = "pages.create";
    pub const PAGES_DELETE: &str = "pages.delete";
    pub const PAGES_MOVE: &str = "pages.move";
    pub const PAGES_PURGE: &str = "pages.purge";
    pub const PAGES_RESTORE: &str = "pages.restore";
    pub const PAGES_SAVE: &str = "pages.save";
    pub const PERMISSIONS_ADMIN_READ: &str = "permissions.admin_read";
    pub const PERMISSIONS_UPDATE: &str = "permissions.update";
    pub const REVISIONS_ADMIN_READ: &str = "revisions.admin_read";
    pub const REVISIONS_RESTORE: &str = "revisions.restore";
    pub const SEARCH_ADMIN_READ: &str = "search.admin_read";
    pub const SYSTEM_BOOTSTRAP: &str = "system.bootstrap";
    pub const SYSTEM_MAINTENANCE: &str = "system.maintenance";
    pub const USERS_CREATE: &str = "users.create";
    pub const USERS_LOCAL_PASSWORD_RESET: &str = "users.local_password_reset";
    pub const USERS_RESET_PASSWORD: &str = "users.reset_password";
    pub const USERS_UPDATE: &str = "users.update";
}

pub mod job_kind {
    pub const EXPIRE_UPLOAD: &str = "expire_upload";
    pub const PURGE_BATCH: &str = "purge_batch";
    pub const REMOVE_FILE: &str = "remove_file";
}

pub mod acl_mode {
    pub const INDEPENDENT: &str = "independent";
    pub const INHERIT: &str = "inherit";
}

pub mod attachment_status {
    pub const PENDING: &str = "pending";
    pub const READY: &str = "ready";
}

pub mod media_type {
    pub const GIF: &str = "image/gif";
    pub const JPEG: &str = "image/jpeg";
    pub const JSON: &str = "application/json";
    pub const OCTET_STREAM: &str = "application/octet-stream";
    pub const PNG: &str = "image/png";
    pub const WEBP: &str = "image/webp";
}

pub mod protocol {
    pub const HEALTH_OK: &str = "ok";
    pub const ATTACHMENT_CSP: &str = "default-src 'none'; sandbox";
    pub const CSRF_TOKEN_HEADER: &str = "x-csrf-token";
    pub const NO_SNIFF: &str = "nosniff";
    pub const NO_STORE: &str = "no-store";
    pub const REQUEST_ID_HEADER: &str = "x-request-id";
    pub const SECURE_COOKIE_SUFFIX: &str = "; Secure";
    pub const SESSION_COOKIE_PREFIX: &str = "wiki_session=";
}

pub mod defaults {
    pub const APP_BASE_URL: &str = "http://127.0.0.1:5173";
    pub const BIND_ADDR: &str = "127.0.0.1:8080";
    pub const LOG_LEVEL: &str = "info";
    pub const PRODUCTION_ENV: &str = "production";
    pub const SESSION_TTL: &str = "28800";
}

pub mod auth {
    pub const GLOBAL_LOGIN_BUCKET: &str = "__global__";
    pub const TIMING_PASSWORD: &str = "dummy-password-for-timing";
}
