# 安装、操作与运维

## 本机开发

加载根目录`.env`，执行`make migrate`，然后分别启动`cargo run --manifest-path backend/Cargo.toml --bin wiki-api`和`cd frontend && npm run dev`。Windows可通过WSL转发访问`http://127.0.0.1:5173`；健康检查用`curl.exe -i --max-time 5 http://127.0.0.1:8080/health/ready`查看状态码（成功返回JSON）。开发账号保留，不要重复bootstrap。

## 生产容器安装

需要Linux Docker Engine与Compose v2。复制`deploy/env.example`到Git外的受限文件，填入随机数据库密码、URL编码后的DATABASE_URL、实际HTTPS域名和证书目录。`APP_BASE_URL`必须与浏览器origin完全一致，不带尾斜杠；默认仅绑定127.0.0.1，内网发布时显式填写WIKI_BIND。数据库没有宿主机发布端口，附件卷不提供静态访问。

证书目录含`fullchain.pem`与`privkey.pem`，网关UID101必须能够读取；使用受信任的内网CA证书。测试证书仅用于验收。API以UID10001运行，网关UID101，文件系统只读、能力全部移除；附件卷和/tmp除外。代理覆盖转发头，后端不信任客户端提供的代理IP作授权依据。

```bash
export DEPLOY_ENV=/absolute/path/wiki-production.env
# 联网构建，代理环境需要构建容器可达；使用本机回环代理时可增加 --network host
# 镜像固定版本；离线安装不需要执行build。
docker compose --env-file "$DEPLOY_ENV" -f deploy/compose.yaml build
docker compose --env-file "$DEPLOY_ENV" -f deploy/compose.yaml up -d
# 首次初始化：密码文件权限600，至少12字符；仅成功一次。
docker compose --env-file "$DEPLOY_ENV" -f deploy/compose.yaml exec -T api bootstrap admin < /protected/password-file
```

HTTPS下拒绝旧短密码登录。开发库mayao账号未擅自改密；如果迁入正式环境，先使用管理员界面或本机`reset-password USERNAME < protected-password-file`更新密码并撤销旧会话。详见TODO.md SEC-001。

## 离线包

联网构建并验证后设置`RELEASE_DIR`（不存在的输出目录），运行`bash scripts/offline-package.sh`。包包含API、网关和PostgreSQL镜像、镜像元数据、源码归档、文档、安装脚本及SHA256SUMS。

在无公网目标机器上先安装Docker和Compose，将包及受限部署配置、TLS证书传入。设置`RELEASE_DIR`与`DEPLOY_ENV`，执行包内`bash scripts/offline-install.sh`。脚本先校验文件，再docker load，使用`--no-build --pull never`启动。前端不使用公网字体、CDN或远程脚本。离线镜像包不包含实例密码、TLS私钥或业务数据。

## 日常使用

启用用户可创建私有知识库；给用户或组授予查看、编辑、管理权限。独立页面授权替换继承，所有者和系统管理员仍可管理。停用用户立即拒绝访问；库所有者停用前需转让库。

进入知识库创建页面/子页面。编辑停止2秒后保存个人草稿，只有“保存共享版本”才发布。冲突时保留本地内容，可查看最新版本、复制或明确选择新基准。历史恢复追加新版本，权限不会回滚；草稿需自行保留/放弃。

附件先选择文件再上传，失败可重试；编辑状态可插入图片或附件链接。默认上限50MiB。改变UPLOAD_MAX_BYTES时同步调整Nginx client_max_body_size。图片按文件签名识别；HTML/SVG等以附件下载。撤权或删除页面后，附件也不可下载。

移动和删除需要管理完整子树，先预览再确认。移动不能跨库，最大64层。回收站只显示当前可管理的完整批次；恢复可指定同库父页面，留空回库根目录。此前单独删除的子页不会随父页恢复。删除30天后后台永久清理，无法再通过回收站找回。

搜索匹配当前共享版本，支持标题/正文、知识库ID及四种人员关系。`%`、`_`按字面匹配，不是通配符。摘要和列表均实时鉴权；不搜索个人草稿或回收站。人员选择器只显示可见内容相关人员。管理后台可查询审计动作、磁盘空间、任务积压及失败重试；重试不能跳过保留期。

## 一致备份与恢复

每日备份到独立存储，并按月演练；实例配置和TLS密钥另行加密备份。保留至少7个日备份和4个周备份；具体容量与保留要求由部署者确定。未设置外部备份目的地前不能声称已有异地备份。

容器备份：设置`DEPLOY_ENV`、`BACKUP_DIR`新目录，运行`bash scripts/compose-backup.sh`。脚本进入维护并等待现有业务写锁，暂停后台写入，导出数据库与附件tar，写校验清单，最后恢复原维护状态。数据一致点以维护屏障为界；维护期间禁止发布新正文/附件。

恢复到全新Compose项目和空卷：设置相应配置及BACKUP_DIR，运行`bash scripts/compose-restore.sh`。脚本拒绝非空库/附件目录，校验备份和tar路径。启动服务、确认页面/版本/权限/附件后，明确执行`docker compose ... exec -T api maintenance off`。恢复期间维护模式保持开启；验证失败不要覆盖旧实例。

非容器实例可使用`python3 scripts/backup.py NEW_DIRECTORY`及`python3 scripts/restore.py BACKUP_DIRECTORY`，从环境读取DATABASE_URL与ATTACHMENT_DIR。必须使用空目标数据库。`scripts/recovery-drill.py`在临时数据库真实验证恢复，结果见recovery-drill.json；该小样本RTO不是20GB附件容量保证。

## 升级与故障诊断

升级前一致备份→进入维护→加载新镜像→单次迁移→启动新API和网关→检查ready及关键业务→退出维护。`migrate`可重复运行，应用不会自行偷偷迁移。旧二进制回退不代表数据库可降级；失败时保留原库并恢复匹配备份到新实例。

健康503：检查数据库、迁移版本和附件目录。登录403：检查origin完全一致、Cookie/Secure、CSRF、账号状态或短密码策略。页面404同时表示不存在或无权，不能据此确认私密页面存在。

任务失败：查看管理界面类型/次数与磁盘空间；解决磁盘满、权限或配置后重试。日志不包含上传正文、密码或会话令牌。上传中断留下的pending记录及文件在1小时宽限后清理；ready附件不会被上传补偿任务删除。

Docker Hub超时而宿主curl正常：确认Docker守护进程代理。守护进程代理与容器构建内代理是两个配置；本次WSL使用127.0.0.1:7897，其他机器须替换为自己的可达代理，不应照抄此端口。

## 容量与边界

最终本机基准见benchmark-optimized.json，查询计划见search-query-plan.json。测试包含10万中文页面、100账号、20并发、8层结构与1000个独立授权边界；每项60次测量。关键词为“部署”，不代表任意稀有词/短词或20GB附件的最坏情况。全局写屏障优先保证撤权一致性，大附件上传会暂时阻塞其他写操作（120秒超时）；多人持续大文件上传应另做容量评测。

权限边界字段只缓存树结构中的最近独立授权节点，不缓存用户角色；数据库触发器在移动/继承切换时事务内更新后代。账号状态、组成员和ACL始终实时计算。

首版不包含实时协同、企业登录、评论通知和导入导出。历史对照为标题/纯文本并排，未提供逐字差异高亮。UI包含大vendor分包，首次加载仍有优化空间。

生产备份调度模板为`deploy/wiki-backup.service`和`.timer`，每日03:00运行（随机延迟不超过5分钟，错过启动后补跑）。部署到`/opt/build-a-wiki`并准备`/etc/build-a-wiki/backup.env`后，将模板安装到systemd目录，执行`systemctl enable --now wiki-backup.timer`，先手动启动一次service并检查备份及日志。BACKUP_MOUNT和BACKUP_ROOT必须由部署者指向实际独立存储；挂载不存在时脚本拒绝回落到本地目录，；本次未擅自创建外部存储或启用针对未知正式实例的定时任务。备份长期保留清理应按实际容量设置，模板不自动删除已有备份。
