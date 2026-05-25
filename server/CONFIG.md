# 随机生成文案功能 - 配置说明

## 功能说明

1. **随机生成文案**:点击按钮后，后端将预存的 prompt 发送给豆包模型，豆包返回关键词并显示在文案框中，支持用户编辑。
2. **生成图片**:用户点击「生成图片」时，文案框内容会与固定后缀拼接，作为 `prompt` 发给即梦 API 生成图片。

---

## 需要提供的配置

在 `server/.env` 中添加以下变量:

### 1. 豆包 API（随机生成文案）

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `DOUBAO_API_KEY` | ✅ | 火山方舟 API Key。在 [火山方舟控制台](https://console.volcengine.com/ark) 创建推理接入点后获取 |
| `DOUBAO_API_URL` | 否 | 默认 `https://ark.cn-beijing.volces.com/api/v3/responses`（Responses API）。若接入点仅支持 Chat Completions，改为 `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| `DOUBAO_MODEL` | 否 | 模型 ID（如 `doubao-seed-1-6-flash-250828`），默认 `doubao-pro-32k-240615` |

### 2. 即梦 API（已配置则无需改动）

| 变量名 | 说明 |
|--------|------|
| `JIMENG_ACCESS_KEY_ID` / `JIMENG_SECRET_ACCESS_KEY` / `JIMENG_SERVICE` | AK/SK 签名方式；**方案一与方案二、4.0 与 3.0 共用同一套** |
| `JIMENG_API_KEY` | 或 Bearer API Key |
| `JIMENG_REQ_KEY` | [即梦图片生成 4.0](https://www.volcengine.com/docs/85621/1817045) 的 `req_key`（方案一 `/api/jimeng`、方案二选用 4.0 模版时） |
| `JIMENG_REQ_KEY_IMAGE_46` | [即梦图片生成 4.6](https://www.volcengine.com/docs/85621/2275082?lang=zh) 的 `req_key`，默认 **`jimeng_seedream46_cvtob`**（与文档固定值一致；方案二选用 `image_4_6` 模版时） |
| `JIMENG_REQ_KEY_T2I_V30` | [即梦文生图 3.0](https://www.volcengine.com/docs/85621/1616429?lang=zh) 的 `req_key`，默认 `jimeng_t2i_v30`（方案二选用 3.0 模版时） |

### 3. 垫图上传（本地 Express 与线上一致）

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `BLOB_READ_WRITE_TOKEN` | ✅（本地跑 `server` 且需上传垫图时） | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) 读写令牌；`/api/upload-image` 将文件传到 Blob 并返回 **公网 HTTPS URL**，即梦才能拉取参考图。与根目录 `api/upload-image.js` 行为一致。 |

### 4. Google Gemini（部分封面模版「参考图预处理」）

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `GEMINI_API_KEY` | 使用带 Google 预处理的模版时 | [Google AI Studio](https://aistudio.google.com/) API Key；`/api/google-preprocess-reference` 调用图片模型优化人物参考图后再走即梦。 |
| `GEMINI_IMAGE_MODEL` | 否 | 默认 `gemini-3.1-flash-image-preview`（[文档](https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn)）。 |

若接口返回 **User location is not supported**，表示当前**请求出口 IP 所在地区**不在 Google 该 API 允许范围内，需更换网络/部署区域或使用 Vertex 等其它接入方式，无法仅靠改本地业务代码绕过。

预处理文案按模版 ID 配置在 `src/data/coverTemplateGooglePreprocess.json`。

---

## 获取豆包 API Key

1. 登录 [火山引擎控制台](https://console.volcengine.com/)
2. 进入 **火山方舟**（或 AI 推理）
3. 创建推理接入点，选择豆包相关模型
4. 获取 API Key 或 endpoint 信息
5. 将 API Key 填入 `DOUBAO_API_KEY`

---

## .env 示例

```env
# 豆包（随机生成文案）
DOUBAO_API_KEY=your-doubao-api-key-here
# DOUBAO_MODEL=doubao-pro-32k-240615

# 即梦（AK/SK 见上方）
```

---

## 自定义文案逻辑

- **豆包 prompt / 即梦后缀**：方案一写在 `src/config/promptDefaults.ts`，改后需重新 build 前端；后端 `lib/promptDefaults.js` 仅在前端未传 `systemPrompt` 时作兜底。
