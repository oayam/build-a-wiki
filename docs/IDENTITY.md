# 身份与权限运维

## 首次初始化

先执行迁移，再运行 `cargo run --manifest-path backend/Cargo.toml --bin bootstrap -- USERNAME < /path/to/password-file`。密码文件由操作员创建，限制为本人读取，用后删除；也可通过隐藏输入的终端管道传入。不要把密码作为命令行参数或写入仓库。密码至少12字符、最多256字节。

初始化仅限本机CLI，无HTTP入口、无固定密码。任何用户已经存在即永久关闭初始化；全局授权屏障保证并发最多一个成功。初始化与审计同事务提交。

审计字段采用允许列表：role、active、acl_version、member_count、owner_id。密码、令牌、完整请求体不记录。请求ID关联HTTP日志；本机初始化单独生成ID。
