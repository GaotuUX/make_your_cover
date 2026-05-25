/**
 * 关闭 axios 对 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY 的自动使用。
 * 本机若设为 socks5://（如 Clash），会与 Node 内 follow-redirects 断言冲突（protocol mismatch）。
 * 火山方舟、即梦等为国内 HTTPS，一般直连即可。
 */
export const AXIOS_NO_ENV_PROXY = { proxy: false }
