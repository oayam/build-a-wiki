import React from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  NavLink,
  Routes,
  Route,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { ConfigProvider, Button, Alert, Spin, Empty } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEditor, EditorContent } from "@tiptap/react";
import { extensions, fixture, plainText } from "./editor";
import { health } from "./api";
import { zh } from "./locales/zh";
import "./style.css";
import { SessionGate, Account, useSession } from "./session";
import Users from "./Users";
import { LibraryPages, PageScreen, SharedPages } from "./Pages";
import { Libraries, PermissionPanel } from "./Knowledge";
function Status() {
  const q = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => health(signal),
    retry: 1,
  });
  if (q.isPending)
    return (
      <div role="status">
        <Spin /> {zh.loading}
      </div>
    );
  if (q.isError)
    return (
      <Alert
        type="error"
        showIcon
        message={zh.error}
        description={q.error.message}
        action={<Button onClick={() => void q.refetch()}>{zh.retry}</Button>}
      />
    );
  return (
    <Alert
      type="success"
      showIcon
      message={zh.ready}
      description={`状态：${q.data.status}`}
    />
  );
}
function Prototype() {
  const editor = useEditor({ extensions, content: fixture });
  const [text, setText] = React.useState("");
  return (
    <>
      <h1>{zh.editor}</h1>
      <Alert type="info" message={zh.prototype} />
      <div className="toolbar">
        <Button onClick={() => editor?.chain().focus().toggleBold().run()}>
          粗体
        </Button>
        <Button
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          标题
        </Button>
        <Button
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          列表
        </Button>
        <Button onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
          代码
        </Button>
        <Button
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
              .run()
          }
        >
          表格
        </Button>
        <Button onClick={() => editor && setText(plainText(editor.getJSON()))}>
          提取纯文本
        </Button>
      </div>
      <EditorContent editor={editor} />
      {text && <pre aria-label="纯文本预览">{text}</pre>}
    </>
  );
}
function App() {
  const { user } = useSession();
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span>W</span>
          {zh.brand}
        </div>
        <div className="workspace">{zh.workspace}</div>
        <nav>
          <NavLink to="/" end>
            {zh.home}
          </NavLink>
          <NavLink to="/shared">{zh.shared}</NavLink>
          <NavLink to="/editor">{zh.editor}</NavLink>
          <NavLink to="/status">{zh.status}</NavLink>
          {user.is_system_admin && (
            <NavLink to="/admin/users">账号与用户组</NavLink>
          )}
        </nav>
        <footer>团队知识库</footer>
      </aside>
      <div className="content">
        <header>
          知识管理 / 工作台
          <Account />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Libraries />} />
            <Route
              path="/knowledge-bases/:id/permissions"
              element={<PermissionPanel />}
            />
            <Route path="/pages/:id" element={<PageScreen />} />
            <Route path="/knowledge-bases/:id" element={<LibraryPages />} />
            <Route
              path="/pages/:id/permissions"
              element={<PermissionPanel page />}
            />
            <Route
              path="/admin/users"
              element={
                user.is_system_admin ? (
                  <Users />
                ) : (
                  <Alert type="error" message="没有管理权限" />
                )
              }
            />
            <Route path="/shared" element={<SharedPages />} />
            <Route path="/editor" element={<Prototype />} />
            <Route
              path="/status"
              element={
                <>
                  <h1>{zh.status}</h1>
                  <Status />
                </>
              }
            />
            <Route path="*" element={<Empty description={zh.notFound} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <SessionGate>
        <App />
      </SessionGate>
    ),
  },
]);
const client = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#287d68",
          borderRadius: 8,
          fontFamily: "system-ui, sans-serif",
        },
      }}
    >
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
