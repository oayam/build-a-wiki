# T59 候选版试用记录

候选版本：0.1.0-rc1。自动验收及离线安装已通过；目前尚未收到真实使用者反馈，因此T59与依赖它的T60没有勾选完成。

## 本机候选实例

前端已按 `design/Build-a-Wiki主界面设计稿.png` 改版，本机使用 `ui-refresh` 网关镜像；截图、验证和回退方法见 [UI_REDESIGN.md](UI_REDESIGN.md)。

地址：https://127.0.0.1:18443（本机测试证书）。这是独立的`wiki-acceptance`容器项目，不使用wiki_dev数据库；原有mayao账号和开发内容保持不变。

管理员用户名：root。随机密码位于工作区`.data/wiki-acceptance-password`（权限600，未纳入Git或离线包）。Windows PowerShell可通过以下命令读取本机文件：

```powershell
wsl.exe -u root cat /root/build-A-wiki/.data/wiki-acceptance-password
```

测试证书仅适用于当前本机验收。正式部署应使用受信任的内网CA证书和自己的强密码。

## 建议真实试用流程

1. 建立一个与你的实际工作相关的知识库和多层页面，录入一篇真实格式的中文文档。
2. 创建编辑者和只读者账号，切换账号检查共享、撤权及独立子页面入口是否符合预期。
3. 上传常用文件与图片，保存并刷新；测试个人草稿与历史恢复。
4. 用两个浏览器窗口修改同一页面，确认冲突提示及本地内容找回方式容易理解。
5. 搜索文档，尝试人员关系筛选、页面移动、删除和恢复。
6. 反馈无法完成的操作、页面显示问题、权限结果异常或使用体验问题；附页面位置和操作步骤即可，不需要提供密码。

已观察并修复的代理验收问题：图片默认width/height属性被后端拒绝；10万页搜索逐页递归授权过慢；手动任务重试可能跳过保留时间；Docker守护进程/构建容器代理分离；Docker内部网络不能发布入口端口。修复及针对性回归均已完成。这些自动/代理验收结果不冒充真实团队反馈。

## 候选实例管理

```bash
# 从仓库根目录执行；不删除卷。
docker compose --env-file .data/compose-test.env -p wiki-acceptance -f deploy/compose.yaml -f deploy/compose.ui-preview.yaml stop
docker compose --env-file .data/compose-test.env -p wiki-acceptance -f deploy/compose.yaml -f deploy/compose.ui-preview.yaml up -d --no-build --pull never
```

试用库已做一致备份，位于`.data/container-backup`。该目录是本机演练备份，尚未复制到独立机器，不能称为异地备份。生产发布前还需配置实际备份目的地与调度策略。

收到反馈后完成T59的修复和受影响回归，再完成T60正式版本、发布包及交接记录。当前离线包为发布候选，不是已完成真实试用的正式版本。
