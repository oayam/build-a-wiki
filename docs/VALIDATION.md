# T0～T12 验证记录

## 可复现命令

- `make check`：前端严格类型、格式、Vitest、生产构建；Rust 格式、Clippy（警告视为错误）、单元/数据库测试；OpenAPI 与客户端生成差异检查。
- `DATABASE_URL=... make migrate`：迁移命令；可重复执行。
- `DATABASE_URL=... python3 scripts/smoke.py`：真实 HTTP 进程、live/ready/404、request_id、SIGTERM 优雅退出。
- `PATH="$HOME/.cargo/bin:$PATH" python3 scripts/licenses.py`：生成实际解析的依赖元数据。

## 风险验证范围

权限测试是隔离 schema 内的最小关系模型，不开放业务 API。矩阵涵盖所有者、系统管理员、停用账号、只读、编辑、无权、组成员；验证独立子页可见、继承被替换、用户+组取最高角色。两条并发用例通过 pg_stat_activity 的 Lock 等待确认真正重叠，再释放屏障，分别断言撤权先提交时写入被拒、已有写事务可以先提交。T20 仍需把此规则接入正式权限服务，T48 才验收所有内容入口撤权。

编辑器验证包括 schema 层 JSON 往返与实际 DOM Editor 挂载、setContent、中文/代码/表格渲染；不是将 JSON.stringify 自身当作编辑器测试。

readiness 使用未迁移 schema、迁移完成、缺失目录、已关闭连接池四种状态验证；失败详情不泄漏数据库地址。完整业务场景仅在 ACCEPTANCE.md 定义，尚未执行 T13 以后业务验收。

## 本轮结果

2026-11-16 实际结果：

- `scripts/check.sh` exit 0：前端7测试、Rust2单元测试、3数据库集成测试全部通过；格式、严格类型、Clippy、生产构建、契约一致性通过。
- 开发库迁移连续执行两次 exit 0；测试另验证随机空 schema 重复迁移。
- `scripts/smoke.py` exit 0：真实 HTTP、request_id、标准404、SIGTERM 和 Vite 前端代理访问 ready 全部通过；测试进程已退出。
- 故意改变 OpenAPI 文件后，契约检查非零退出；恢复原文件，证明 CI 可检测漂移。
- npm audit：0 vulnerabilities；Rust 全量许可证和 npm 已安装包许可证字段均非空。
- PostgreSQL 14/main 保持运行，wiki_dev/wiki_test 保留；不留前后端测试服务器。
- 开发完成时目录尚不是有效 Git 仓库；随后按用户要求初始化 main 分支，并将产物纳入首次提交（提交信息 mayao）。

限制：未进行生产容器构建、浏览器端到端业务验收或容量压测；它们属于后续任务。本阶段 UI 的 DOM 编辑器与 HTTP 连通已经验证。
