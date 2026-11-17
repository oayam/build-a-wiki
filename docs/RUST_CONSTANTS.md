# Rust 字符串常量约定

运行时使用的稳定字符串集中在 `backend/src/constants.rs`，按用途划分子模块；常量采用 `UPPER_SNAKE_CASE` 命名。字符串常量使用 `&str`，不分配可变的 `String`，仅在返回结构需要拥有字符串时调用 `.into()`。

```rust
pub mod error_code {
    pub const NOT_FOUND: &str = "NOT_FOUND";
}

pub mod message {
    pub const NOT_FOUND: &str = "资源不存在";
}
```

调用处使用带分类的名称，区分机器错误码与用户文案：

```rust
use crate::constants::{error_code, message};

Failure(StatusCode::NOT_FOUND, error_code::NOT_FOUND, message::NOT_FOUND)
```

## 分类

| 子模块 | 用途 |
| --- | --- |
| `error_code` | 对外 API 错误码 |
| `message` | 错误文案、校验提示和业务说明 |
| `audit_action` | 审计事件标识 |
| `env` | 环境变量名 |
| `defaults` | 配置默认字符串及生产环境标识 |
| `job_kind` | 持久化任务类型，供入队和执行分支共同引用 |
| `acl_mode` | 权限继承模式 |
| `attachment_status` | 附件状态比较值 |
| `media_type` | MIME 类型 |
| `protocol` | 自定义 HTTP 头、Cookie 片段、安全响应值和健康状态 |
| `auth` | 登录限流桶及时间均衡校验使用的固定输入 |

标准 HTTP 头名称优先使用 `axum::http::header` 已有常量。单个模块内部的实现细节如果需要命名，优先定义私有常量；不要把所有局部字符串都放入公共模块。

## 保留字面量的场景

- SQL 保留完整语句，包含数据库约束所使用的枚举值；不要为了提取文本而改成字符串拼接 SQL。调整任务类型、权限模式或附件状态时，须同时核查迁移和 SQL 中对应的值。
- `format!`、日志格式串及 `utoipa` 等要求字面量的宏参数继续使用字面量。
- JSON 字段名、富文本结构字段、路由路径、文件签名字节、空字符串等结构性值不在本轮批量提取范围内。
- 测试保留独立的预期字符串，避免实现与测试共享同一错误常量而掩盖接口变化。
- 常量集中管理不等于可随意修改：错误码、审计事件和已持久化任务类型必须考虑兼容性。

## 本轮验证

共提取 146 个字符串常量，覆盖 API、后台任务和维护命令；不更改原字符串值、数据库结构或 API 契约。`cargo fmt --check`、全目标 Clippy（警告视为错误）通过；17 项 Rust 单元及数据库集成测试全部通过。随后将 Cache-Control 头改用框架常量，并再次通过 Clippy 和 6 项单元测试。生成的 OpenAPI 与 `docs/openapi.json` 完全一致。未安装新依赖。
