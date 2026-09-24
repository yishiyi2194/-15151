# PaintAI 酒馆文生图教程

本教程说明如何在 Windows 版 SillyTavern 中填写 PaintAI 网站 URL 和项目 Token，直接调用网站额度生成图片。

## 一、工作方式

插件由两部分组成，必须同时安装：

- 酒馆前端扩展：显示设置面板、检查额度、提交提示词、接收图片。
- 酒馆服务端桥接：从酒馆同源地址转发请求，向 PaintAI 网站发送 `Authorization` 和 `X-User-Token`。

酒馆不会把 Token 写入聊天、源码、安装包或插件持久化设置。刷新页面后需要重新填写 Token。

## 二、准备环境

- SillyTavern `1.13.3` 或更高版本；推荐 `1.19.0`。
- Node.js `20` 或更高版本。
- 已能访问 PaintAI 网站：`https://www.r67831767.nyat.app:19088`
- 一个由 PaintAI 网站签发的项目 Token。它不是 NovelAI 官方 API Key。

## 三、安装插件

1. 解压 `PaintAI-SillyTavern-1.0.0.zip`。
2. 在解压后的插件目录打开 PowerShell。
3. 执行下面的命令：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TavernRoot 'M:\SillyTavern'
```

脚本会：

- 安装前端扩展到 `public\scripts\extensions\third-party\paintai`。
- 安装服务端桥接到 `plugins\paintai-bridge`。
- 将 `config.yaml` 的 `enableServerPlugins` 设置为 `true`。
- 把原配置和同名插件备份到 `M:\SillyTavern\backups\paintai-install-时间戳`。

安装完成后，完全关闭并重新启动 SillyTavern，再刷新浏览器页面。

## 四、填写网站 URL 和 Token

1. 打开 SillyTavern 的“扩展”设置。
2. 打开“PaintAI 出图”。
3. 在“服务地址”填写：

```text
https://www.r67831767.nyat.app:19088
```

不要在地址后面追加 `/api`、`/api/tokens/check` 或其他路径。

4. 在“项目 Token”粘贴网站签发的 JWT。带有 `Bearer ` 前缀也可以，插件会自动处理。
5. 点击“检查连接 / 额度”。这一步只检查 Token，不扣出图额度。

## 五、生成图片

1. 打开一个角色聊天或群组聊天。
2. 在 PaintAI 面板填写英文或中文画面提示词。
3. 选择模型、尺寸、步数和 CFG。
4. 点击“生成图片”。
5. 生成完成后，可以预览、下载，或点击“加入当前聊天”。

也可以在酒馆输入：

```text
/paintai 1girl, garden, sunlight
```

默认只生成一张文生图，不会自动读取聊天内容，也不会接管酒馆原生 `/imagine` 命令。

## 六、手机使用

手机不能直接访问电脑上的 `127.0.0.1`。需要让运行 SillyTavern 的电脑提供局域网或公网 HTTPS 地址，并确认：

- 手机可以打开该酒馆地址。
- 电脑防火墙放行酒馆端口。
- 反向代理允许 WebSocket 和 SSE 长连接。
- PaintAI 网站地址仍然使用 HTTPS，端口保持 `19088`。

手机端填写的 PaintAI 服务地址仍是网站根地址，不是酒馆地址。

## 七、常见问题

### 扩展设置里没有 PaintAI

确认前端目录存在：

```text
M:\SillyTavern\public\scripts\extensions\third-party\paintai
```

重启酒馆并刷新浏览器缓存。

### 提示“服务端插件未加载”

确认以下文件存在：

```text
M:\SillyTavern\plugins\paintai-bridge\index.mjs
M:\SillyTavern\plugins\paintai-bridge\config.json
```

同时确认 `M:\SillyTavern\config.yaml` 包含：

```yaml
enableServerPlugins: true
```

修改后必须重启酒馆。

### 提示“地址不在允许列表”

打开：

```text
M:\SillyTavern\plugins\paintai-bridge\config.json
```

确保 `allowedOrigins` 中的地址与面板填写的地址完全一致，包括 HTTPS 和端口，但不包含路径、查询参数或片段。

### Token 无效或额度不足

回到 PaintAI 管理端检查 Token 是否过期、被吊销或额度耗尽。插件不会绕过网站校验，也不会自动更换 Token。

### 生成失败后是否会扣费

网站会在出图请求开始时按现有规则扣除额度。取消或上游失败不保证退款，建议先用“检查连接 / 额度”确认 Token 状态，再提交生成。

## 八、卸载

删除以下两个目录后重启酒馆：

```text
M:\SillyTavern\public\scripts\extensions\third-party\paintai
M:\SillyTavern\plugins\paintai-bridge
```

不要因为卸载 PaintAI 而关闭其他插件依赖的全局服务端插件开关。原配置可从 `M:\SillyTavern\backups\paintai-install-时间戳` 恢复或对照。

## 九、开发验证

在插件项目根目录执行：

```powershell
node --test tests/*.test.mjs server-plugin/tests/*.test.mjs
```

测试使用假 Token 和模拟上游，不会产生真实 NovelAI 出图费用。真实网站、账号池余额、反向代理和手机网络访问需要安装后单独验收。
