# Build-a-Wiki

T0～T24：中文登录与账号/组管理、私有知识库、所有权转让、继承/独立ACL权限管理、审计与安全会话。正文编辑持久化、页面树、附件与搜索属于后续阶段；编辑器验证页仍是本地原型。

## 本机开发

环境版本见 dependency.txt 和 docs/TOOLCHAIN.md。安装 Rust 后将 `$HOME/.cargo/bin` 加入 PATH。

```bash
# Ubuntu 22.04，需系统安装权限
sudo apt-get install build-essential pkg-config libssl-dev postgresql-14 postgresql-client-14
sudo bash scripts/dev-db.sh
cp .env.example .env
set -a
source .env
set +a
mkdir -p .data/attachments
(cd frontend && npm ci)
make migrate
# 首次部署：从受限密码文件读取初始化管理员密码（仅成功一次）
cargo run --manifest-path backend/Cargo.toml --bin bootstrap -- admin < /path/to/password-file
# 终端1（从根目录启动，附件路径相对根目录）
cargo run --manifest-path backend/Cargo.toml --bin wiki-api
# 终端2
cd frontend && npm run dev
```

访问 http://127.0.0.1:5173，Vite 将健康请求转发到 8080。只在本机开发使用示例密码；勿将数据库端口开放给普通客户端。

## 验证

```bash
# 先加载 .env，测试明确使用 wiki_test 而非 wiki_dev
make check
# 修改 HTTP 契约后重新生成并审查 diff
bash scripts/contracts.sh --write
```

集成测试为每次运行创建独立随机 schema，成功后清理；失败保留 schema 供诊断。测试环境缺失必须失败，不能静默跳过。CI 使用独立 PostgreSQL 服务，执行相同脚本。迁移命令可重复执行，服务启动不偷偷迁移；迁移未完成时 readiness 返回503。

## 文档

- docs/CHECKLIST.md：逐项完成证据
- docs/DECISIONS.md：领域、权限、事务与接口规则
- docs/ACCEPTANCE.md：完整业务验收规格，后续任务执行
- docs/BODY_SCHEMA.md：编辑器契约及边界
- docs/openapi.json：从 Rust 类型与路由注解生成的接口契约
- docs/licenses.json：依赖版本与许可证元数据

正式权限函数和统一服务已接入知识库与ACL API；授权写操作使用全局屏障。原型回归测试仍保留。页面创建接口在T26实现，当前页面权限浏览器验收使用隔离数据库夹具。

真实浏览器验收：安装 `cd frontend && npx playwright install --with-deps chromium` 后，先 `cargo build --manifest-path backend/Cargo.toml`，再从根目录运行 `TEST_DATABASE_URL=... python3 scripts/e2e.py`。脚本自行初始化随机schema/管理员密码并启动服务，成功后清理，失败保留schema和trace诊断。身份配置和权限规则见 docs/IDENTITY.md。
