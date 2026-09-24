# PaintAI 酒馆出图插件

填写 PaintAI 网站 URL 和项目 Token，在 SillyTavern 中生成图片，预览、下载并加入当前聊天。使用现有 PaintAI 账号池和计费接口，不需要更改 Java 后端。

完整安装和使用步骤见 [`TUTORIAL.md`](TUTORIAL.md)。

## 安装

要求 SillyTavern **1.13.3 或更新版本**、Node.js **20 或更新版本**。本次实际目标是用户本地 1.13.3；其他版本须以验证记录为准。

安装包有两个部分，两者都需要安装：

- `extension/` → `SillyTavern/public/scripts/extensions/third-party/paintai/`
- `server-plugin/` 的运行文件 → `SillyTavern/plugins/paintai-bridge/`

### Windows 安装脚本

解压安装包后，在该目录打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TavernRoot 'M:\SillyTavern'
```

脚本检查版本、复制插件、将酒馆 `config.yaml` 中 `enableServerPlugins` 改为 `true`。原配置和已存在的同名插件备份到酒馆 `backups/paintai-install-时间戳/`，不修改角色、聊天或 API 密钥。随后手动重启酒馆并刷新页面。

也可以按上面目录手动复制，并手动设置 `enableServerPlugins: true`。本安装包没有发布到 Git 仓库，不能直接把本地 ZIP 粘贴进“通过 URL 安装扩展”。

## 使用

1. 在酒馆“扩展设置”中打开 **PaintAI 出图**。
2. 服务地址默认是 `https://www.r67831767.nyat.app:19088`，保留端口，不追加 `/api` 路径。
3. 填写该网站签发的项目 Token，不是 NovelAI 官方密钥。可粘贴带 `Bearer ` 前缀的值。
4. 点击“检查连接 / 额度”。检查不扣费。
5. 打开角色或群组聊天，填写画面提示词，点击“生成图片”；或者发送 `/paintai 1girl, garden, sunlight`。
6. 最终图片保存到酒馆图片目录，并在当前聊天中显示。也可先取消“完成后加入当前聊天”，生成后下载或手动加入。

Token 仅在当前页面内存和本次请求中使用，刷新页面需重新填写；不会保存到插件设置、聊天、源码或安装包。普通参数会保存到酒馆账户设置。

## 范围和行为

- 当前提供单张文生图，支持 NovelAI 4.5 Full / Curated、网站已有五种尺寸、1–28 步、CFG 1–30。
- 不接管原生 `/imagine`，使用独立 `/paintai` 命令。不会自动读取聊天内容或自动触发付费出图。
- 同一页面只执行一个请求，生成失败不自动重试。只有完整 `final` 图片才作为成功，断流的中间图不会被误存为结果。
- 生成期间切换聊天，图片保留在面板，避免误写进另一聊天；可手动“加入当前聊天”。
- 取消会终止等待和酒馆转发连接，但现有 PaintAI 服务预先扣额，取消或失败不保证退款。可检查额度后自行决定是否重试。
- 参考图、图生图、角色参考和模型自动读取剧情不在本版本范围内。

## 为什么需要服务端插件

当前网站浏览器跨域预检不允许出图所需鉴权头。前端发送同源请求到酒馆，服务端插件再向网站固定接口转发，携带 `Authorization` 与 `X-User-Token`，保持网站的正常额度校验。

服务端仅访问 `config.json` 的 `allowedOrigins` 中精确列出的 HTTPS 地址，默认只有上面的域名。要换网站，先修改酒馆 `plugins/paintai-bridge/config.json` 的允许列表，重启酒馆，再在面板填写同一地址。不能填任意带路径的转发 URL。插件使用酒馆原有登录与 CSRF 中间件，不需要启用全局 CORS proxy。

## 排错

- “服务端插件未加载”：确认两部分安装完整，`enableServerPlugins: true`，并已重启酒馆。
- “地址不在允许列表”：对照服务端 `config.json`，域名、HTTPS 和端口都必须一致。
- Token 无效或额度不足：回到 PaintAI 管理端处理，本插件不绕过检查。
- 上游无法连接：检查运行酒馆的电脑能否连接网站，不只检查浏览器能否打开首页。
- 图片生成完成但聊天未保存：保留下载图片，检查酒馆连接；插件不会自动再扣额出图。

## 验证与开发

```powershell
node --test tests/*.test.mjs server-plugin/tests/*.test.mjs
```

实际验证结果见 `VERIFICATION.md`。所有自动测试使用假 Token 和模拟上游，不代表真实 NovelAI 已完成付费出图。

卸载时移除两个插件目录并重启。不要因卸载此插件而关闭其他插件所需的全局开关；原配置可从安装备份中对照恢复。
