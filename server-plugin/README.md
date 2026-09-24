# PaintAI 酒馆服务端桥接

将本目录复制到 `SillyTavern/plugins/paintai-bridge/`，在酒馆的 `config.yaml` 中启用 `enableServerPlugins: true` 后重启。运行环境为 Node.js 20 或更新版本，无需安装第三方运行依赖。

`config.json` 只保存部署者允许的 HTTPS 来源，不保存 Token。修改允许列表后需要重启；来源不允许用户名、密码、路径、查询或片段。每次请求使用调用方提供的 Token，只访问该来源的两个固定接口，拒绝重定向，不重试，不额外扣费。

| 酒馆同源接口 | 请求 | 返回 |
| --- | --- | --- |
| `GET /api/plugins/paintai-bridge/health` | 无 | `{ok:true,version:"1.0.0"}` |
| `POST /api/plugins/paintai-bridge/check` | `{baseUrl,token}` | 过滤后的 `valid/remaining/quota/used/message` |
| `POST /api/plugins/paintai-bridge/generate` | `{baseUrl,token,payload}` | SSE，图片按块转发 |

POST 沿用酒馆登录和 CSRF 机制，前端应使用酒馆的 `getRequestHeaders()`。查询超时为 20 秒，生成超时为 300 秒，覆盖整个响应体。客户端断开会取消上游请求。发出响应头前的错误返回 JSON `{error:"中文信息"}`；流中错误以 `event_type:error` 结束。不会传回上游 Cookie 或未明确允许的响应头。

生成仅支持 `action:generate`、`params_version:3`、`n_samples:1`；模型为 NovelAI 4.5 full/curated，采样器为 `k_dpmpp_2m/k_euler_ancestral/k_euler/k_dpmpp_sde`。分辨率为 832×1216、1216×832、1024×1024、1024×768、512×768；步数 1–28，CFG 1–30。保留基础 V4 提示词结构，拒绝角色提示词、图生图与参考图片。请求最大 512 KiB，Token 仅接受 16–4096 字符、三段 base64url 的原始 JWT；真实性仍由上游校验。JWT 中的句点不属于图片 base64 字母表，因此完整 JWT 脱敏不会误替换图片内容。

测试入口：`node --test tests/*.test.mjs`。导出的 `createHandlers({allowedOrigins,fetchImpl,generateTimeoutMs,checkTimeoutMs})` 返回 `health/check/generate`；测试或隔离开发服务器可注入假 fetch，给请求设置 `req.body` 后调用 handler，无需真实 Token 或真实出图。`normalizeOrigin()` 与 `validatePayload()` 同样可独立验证。流检查只保留短标记尾部和必要的 Token 前缀，不缓存完整图片；流关闭前须收到 `final` 或 `error` 标记。
