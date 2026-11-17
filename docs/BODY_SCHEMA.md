# 正文契约 v1（T08）

schema_version=1，Tiptap JSON 为事实来源。标题单独保存并共同版本化。可执行原型和样例在 frontend/src/editor.ts，roundTrip 使用 ProseMirror schema 验证结构，并在输出时规范化默认 attrs；规范化后多次 JSON 往返必须严格相等。

节点白名单：doc、paragraph、text、heading(level 1–6)、bulletList、orderedList、listItem、blockquote、codeBlock、hardBreak、horizontalRule、table、tableRow、tableCell、tableHeader、image。marks：bold、italic、strike、code、link、underline。仅 http/https/mailto 链接；不接受脚本或原始 HTML。正文最大2MB，树深64。T25 后端负责强制限制、链接和图片来源校验，不能信任浏览器校验。

图片在正式页面中只接受受控附件 ID 对应 URL；此阶段原型不提供任意图片地址输入/上传，T40 接入附件。纯文本以块间换行生成，保留中文、emoji、代码原文，表格单元格使用换行。固定样例和精确期望见 editor.test.ts。

本阶段编辑器只在浏览器内运行，不保存共享版本，也不冒充已实现业务接口。

DOM 原型验证发现 StarterKit 默认 trailingNode 会在表格后自动添加段落，导致重新加载后 JSON 变化；现已显式禁用 trailingNode，确保无编辑操作的 JSON 往返严格一致。

T25：Rust校验器 backend/src/body.rs 强制版本、2MiB正文、64层嵌套、节点/marks/attrs白名单与结构约束；链接仅http/https/mailto，图片仅接受附件UUID下载路径。中文/代码/表格样例现由 fixtures/body-v1.json 跨前后端共享。正文纯文本由后端生成，不信任客户端。
