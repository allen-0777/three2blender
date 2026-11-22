import { defineConfig } from 'vite';

// 開發時（npm run dev）把 API 轉給本機的後端服務（npm start，預設 3000）
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
});
