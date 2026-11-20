import { defineConfig, loadEnv, type Plugin } from "vite";

const localApi = "http://127.0.0.1:8080";

function localAdminLogin(password: string): Plugin {
  return {
    name: "local-test-login",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/api/v1/auth/test-login") return next();
        const host = req.headers.host;
        const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
        if (
          req.method !== "POST" ||
          !loopback.includes(req.socket.remoteAddress ?? "") ||
          !loopback.includes(req.socket.localAddress ?? "") ||
          !["127.0.0.1:5173", "localhost:5173"].includes(host ?? "") ||
          req.headers.origin !== `http://${host}` ||
          req.headers["content-type"] !== "application/json"
        ) {
          res.writeHead(403).end();
          return;
        }
        try {
          const upstream = await fetch(localApi + "/api/v1/auth/login", {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
            headers: {
              "Content-Type": "application/json",
              Origin: "http://127.0.0.1:5173",
            },
            body: JSON.stringify({ username: "admin", password }),
          });
          const actor = await upstream.json();
          const cookie = upstream.headers.get("set-cookie");
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          if (
            upstream.ok &&
            (!cookie || !actor.is_system_admin || actor.username !== "admin")
          ) {
            res
              .writeHead(403)
              .end(JSON.stringify({ message: "测试管理员不可用" }));
            return;
          }
          if (upstream.ok && cookie) res.setHeader("Set-Cookie", cookie);
          res.writeHead(upstream.status).end(JSON.stringify(actor));
        } catch {
          res
            .writeHead(502, { "Content-Type": "application/json" })
            .end(JSON.stringify({ message: "无法连接本机测试服务" }));
        }
      });
    },
  };
}

export default defineConfig(({ command, mode, isPreview }) => {
  const password =
    command === "serve" &&
    mode === "development" &&
    !isPreview &&
    (!process.env.API_PROXY_TARGET || process.env.API_PROXY_TARGET === localApi)
      ? loadEnv(mode, process.cwd(), "WIKI_TEST_").WIKI_TEST_ADMIN_PASSWORD
      : "";
  return {
    define: { __LOCAL_TEST_LOGIN__: JSON.stringify(Boolean(password)) },
    plugins: password ? [localAdminLogin(password)] : [],
    server: {
      proxy: {
        "/health": process.env.API_PROXY_TARGET || localApi,
        "/api": process.env.API_PROXY_TARGET || localApi,
      },
    },
    build: {
      rollupOptions: {
        onwarn(warning, warn) {
          if (
            warning.code === "MODULE_LEVEL_DIRECTIVE" &&
            warning.message.includes("use client")
          )
            return;
          warn(warning);
        },
        output: {
          manualChunks(id) {
            if (id.includes("@tiptap") || id.includes("prosemirror"))
              return "editor";
            if (id.includes("node_modules")) return "vendor";
          },
        },
      },
    },
  };
});
