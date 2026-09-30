import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发模式：vite 在 41874 提供前端，/api 代理到正在运行的工作台服务（41873）。
// 服务端会拒绝非本源的 Origin，所以代理时改写为服务自己的源。
const API = `http://127.0.0.1:${process.env.WB_PORT || 41873}`;

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500, sourcemap: false, rollupOptions: { input: { main: 'index.html', pet: 'pet.html' } } },
  server: {
    host: '127.0.0.1',
    port: 41874,
    strictPort: true,
    proxy: { '/api': { target: API, changeOrigin: true, headers: { origin: API } } },
  },
});
