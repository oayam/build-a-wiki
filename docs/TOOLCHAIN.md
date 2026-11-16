# 工具链基线

本机 Ubuntu 22.04 amd64；Node 24.22.3（MIT），Rust 1.100.0（MIT/Apache-2.0），PostgreSQL 14.24（PostgreSQL License）。最终容器目标：Linux amd64，Rust 构建产物运行于 Debian bookworm-slim，数据库 PostgreSQL 14.24；生产镜像及摘要在 T49 固定，本阶段不宣称已完成容器发布验证。

前端使用 React 19、Vite 7、TypeScript 5、Tiptap 3；Vite 7 需要 Node >=20.19 或 >=22.12，本机满足。所有 Tiptap 扩展使用同一 3.11.0 版本，使用 MIT 开源 StarterKit/Table/Image，不引入付费或协同扩展。React/Ant Design/TanStack/React Router/Vite 使用 MIT，TypeScript Apache-2.0。后端 Axum/Tokio/SQLx/Serde 使用 MIT 或 MIT/Apache-2.0，实际传递依赖及版本由锁文件和许可证清单记录。

版本来源和兼容证据：安装包 package.json 的 engines/peerDependencies/license；Cargo metadata 的 rust_version/license；实际前后端构建。以 docs/licenses.json 为传递依赖清单（生成时不包括未安装的目标平台包）。锁文件作为可重复解析的依据；不使用浮动 latest 容器。
