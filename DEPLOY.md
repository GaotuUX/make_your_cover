# 部署说明（Vercel 全栈）

前端、API（豆包、即梦、图片上传）均部署在 Vercel 上。

---

## 1. 推送代码到 GitHub

确保 `api/` 目录已提交（包含 `api/doubao.js`、`api/jimeng/`、`api/upload-image.js`）。

---

## 2. 创建 Vercel Blob 存储（图片上传）

1. 打开 Vercel 项目 → **Storage** → **Create Database** → 选择 **Blob**
2. 选择 **Public** 访问权限
3. 创建后会自动添加 `BLOB_READ_WRITE_TOKEN` 环境变量

---

## 3. 配置环境变量

Vercel 项目 → **Settings** → **Environment Variables**，添加:

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `DOUBAO_API_KEY` | ✅ | 豆包 API Key |
| `DOUBAO_API_URL` | 否 | 默认火山方舟 Chat Completions |
| `JIMENG_ACCESS_KEY_ID` | ✅ | 即梦 AK |
| `JIMENG_SECRET_ACCESS_KEY` | ✅ | 即梦 SK |
| `JIMENG_SERVICE` | 否 | 默认 `cv` |
| `JIMENG_REGION` | 否 | 默认 `cn-beijing` |
| `JIMENG_REQ_KEY` | ✅ | 即梦 4.0 req_key |
| `JIMENG_REQ_KEY_IMAGE_46` | 否 | 即梦 4.6，默认 `jimeng_seedream46_cvtob`（见火山文档） |
| `BLOB_READ_WRITE_TOKEN` | ✅ 上传时 | 创建 Blob 存储后自动添加 |

**注意**:不要设置 `VITE_API_URL`，前端会请求同域 `/api/...`。

---

## 4. 部署

Vercel 从 GitHub 拉取代码并部署，`/api/doubao`、`/api/jimeng`、`/api/upload-image` 会自动生效。

---

## 本地开发

- **仅前端**:`npm run dev`，豆包、即梦、上传等 API 需在线上 Vercel 环境测试
- **完整本地测试**:同时运行 `cd server && node index.js` 和 `npm run dev`，本地会代理到 Express 后端

---

## 验证

1. 访问 Vercel 部署地址（如 `https://xxx.vercel.app/`）
2. 测试「随机生成文案」「生成图片」「上传老师参考图」

若 404 或 500，请检查:环境变量是否完整、是否已 Redeploy、是否已创建 Blob 存储（上传功能）。

## 标题网格图永久链接（可选）

标题区域按 Figma 151-150:CSS 渐变（#12a0fe→透明）+ 顶部 96px 网格图。网格图默认使用本地 `src/assets/title-grid.png`。若需使用 Vercel Blob 永久链接:

1. **方式一**:部署后访问 `https://你的域名/upload-title-bg.html`，选择 `scripts/title-grid-upload.png` 上传，复制返回的 URL
2. **方式二**:本地运行 `BLOB_READ_WRITE_TOKEN=你的token npm run upload:title-grid` 获取 URL（token 从 Vercel 控制台 → Storage → Blob 获取）

3. 在项目根目录创建 `.env.local`，添加:`VITE_TITLE_GRID_URL=上一步获得的URL`
4. 重新构建/部署
