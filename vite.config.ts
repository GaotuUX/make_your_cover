import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** 与 server 端口一致（server/index.js: PORT 默认 3000） */
const API_PROXY_TARGET = 'http://localhost:3000'

const apiProxy = {
  '/api': {
    target: API_PROXY_TARGET,
    changeOrigin: true,
    timeout: 600000,
  },
  /** 本地上传落在 server /uploads 静态目录时，避免被 Vite 当项目内路径解析报 Not a valid path */
  '/uploads': {
    target: API_PROXY_TARGET,
    changeOrigin: true,
  },
} as const

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: apiProxy,
  },
  /** `vite preview` 默认不带 dev 的 proxy，需单独配置，否则 /api 会 404 */
  preview: {
    proxy: apiProxy,
  },
  /**
   * Vite 7 默认可用 lightningcss 做 CSS 压缩；在 Vercel 构建后偶发
   * `Error: Unhandled type: "ColonToken"`（平台后续步骤与 lightningcss AST 不兼容）。
   * 显式使用 esbuild 压缩 CSS，避免该管线。
   */
  build: {
    cssMinify: 'esbuild',
    minify: 'esbuild',
  },
})
