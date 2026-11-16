# 身份与权限运维

## 首次初始化

先执行迁移，再运行 `cargo run --manifest-path backend/Cargo.toml --bin bootstrap -- USERNAME < /path/to/password-file`。密码文件由操作员创建，限制为本人读取，用后删除；也可通过隐藏输入的终端管道传入。不要把密码作为命令行参数或写入仓库。密码至少12字符、最多256字节。

初始化仅限本机CLI，无HTTP入口、无固定密码。任何用户已经存在即永久关闭初始化；全局授权屏障保证并发最多一个成功。初始化与审计同事务提交。

审计字段采用允许列表：role、active、acl_version、member_count、owner_id。密码、令牌、完整请求体不记录。请求ID关联HTTP日志；本机初始化单独生成ID。

## 会话与部署配置

APP_BASE_URL 必填，必须是无尾斜线的来源（例如 http://127.0.0.1:5173）；非本机地址必须 HTTPS。SESSION_TTL 默认28800秒，范围60～604800。所有写API（包括登录）检查 Origin；已登录写请求额外检查 X-CSRF-Token，令牌通过 /me 返回并仅在浏览器内存保留。Cookie HttpOnly、SameSite=Strict，HTTPS 下 Secure。

登录失败按用户名15分钟5次及全局100次限流，计数存数据库，进程重启不会清零。停用、重置密码、改变系统管理员角色撤销会话。最后一个启用管理员禁止停用/降级；拥有知识库的账号需先转让全部知识库。组成员撤销使用同一授权屏障。
