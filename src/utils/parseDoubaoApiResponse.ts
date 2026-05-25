/** 校验 /api/doubao 响应是否为 JSON，并给出与 HTTP 状态匹配的可读说明 */
export function assertDoubaoJsonResponse(res: Response): string | null {
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('application/json') || ct.includes('+json')) return null

  const status = res.status
  if (status === 405) {
    return 'HTTP 405：当前站点未允许 POST /api（多为只部署了静态 dist，Nginx 未把 /api 反代到 Node）。请在腾讯云 CVM 上运行 server/index.js，并配置 Nginx location /api/ → 127.0.0.1:3000。'
  }
  if (status === 404) {
    return 'HTTP 404：未找到 /api 路由。请确认 Node 后端已启动，且 Nginx 已反代 /api/ 到后端端口（默认 3000）。'
  }
  if (status >= 200 && status < 300) {
    return '接口返回非 JSON（HTTP 200 多为 index.html）。请确认 Nginx 已将 /api 反代到 Node 后端，而非走 try_files 静态页。'
  }
  return `接口返回非 JSON（HTTP ${status}）。请确认 /api 已反代到 Node 后端，且 server/.env 已配置 DOUBAO_API_KEY。`
}
