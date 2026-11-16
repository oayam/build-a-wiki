import { defineConfig } from 'vite';
export default defineConfig({
  server: { proxy: { '/health': process.env.API_PROXY_TARGET || 'http://127.0.0.1:8080' } },
  build: { rollupOptions: {
    onwarn(warning, warn) {
      if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
      warn(warning);
    },
    output: { manualChunks(id) {
      if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor';
      if (id.includes('node_modules')) return 'vendor';
    } },
  } },
});
