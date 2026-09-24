# PaintAI 酒馆插件通用安装与使用教程

本教程适用于不同 Windows 电脑、不同 SillyTavern 安装目录，以及通过云服务器或安卓 Termux 运行的酒馆。文中的 `<你的酒馆目录>` 必须替换成实际的 SillyTavern 根目录，例如 `D:\Apps\SillyTavern` 或 `M:\SillyTavern`。

## 1. 插件组成

PaintAI 插件由两部分组成，完整使用时都要安装：

```text
前端扩展   -> <你的酒馆目录>\public\scripts\extensions\third-party\paintai
服务端桥接 -> <你的酒馆目录>\plugins\paintai-bridge
```

前端负责设置面板、提示词、图片预览和聊天插入。Node.js 服务端桥接负责向 PaintAI 网站转发鉴权请求。酒馆的 Git 扩展安装器只负责前端，不能代替服务端桥接安装。

## 2. 环境要求

- SillyTavern 1.13.3 或更新版本；推荐使用当前稳定版。
- Node.js 20 或更新版本。
- Git（通过 Git URL 安装时需要）。
- PaintAI 网站地址和该网站签发的项目 Token。

默认 PaintAI 服务地址：

```text
https://www.r67831767.nyat.app:19088
```

这是 PaintAI 网站地址，不是酒馆地址，也不是 NovelAI 官方 API Key。

## 3. 推荐安装方式：安装包和 PowerShell

1. 下载本项目 ZIP 并解压到临时目录。
2. 在解压目录空白处右键，选择“在终端中打开”或打开 PowerShell。
3. 把下面命令中的 `<你的酒馆目录>` 换成真实路径：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TavernRoot '<你的酒馆目录>'
```

例如：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TavernRoot 'D:\Apps\SillyTavern'
```

脚本会：

- 检查 SillyTavern 版本和目录结构。
- 安装前端文件到 `public\scripts\extensions\third-party\paintai`。
- 安装服务端文件到 `plugins\paintai-bridge`。
- 把 `enableServerPlugins` 设置为 `true`。
- 把原配置和已有同名插件备份到 `backups\paintai-install-时间戳`。

脚本不会修改角色、聊天、世界书或 Token。安装后必须完全关闭并重新启动 SillyTavern。

## 4. Git URL 安装方式

在酒馆的“扩展程序”面板选择“安装扩展程序”，粘贴：

```text
https://github.com/yishiyi2194/-15151.git
```

这种方式只安装前端扩展。完成后仍要在运行酒馆的电脑、云服务器或安卓 Termux 中安装 `server-plugin`，并启用：

```yaml
enableServerPlugins: true
```

如果 Git 安装提示目录已存在，请不要重复安装；删除旧的同名扩展目录或使用安装包脚本统一安装。

## 5. 无安装脚本时的手动安装

把仓库中的文件复制到以下目录：

```text
extension\manifest.json -> <你的酒馆目录>\public\scripts\extensions\third-party\paintai\manifest.json
extension\index.js     -> <你的酒馆目录>\public\scripts\extensions\third-party\paintai\index.js
extension\api.js       -> <你的酒馆目录>\public\scripts\extensions\third-party\paintai\api.js
extension\chat.js      -> <你的酒馆目录>\public\scripts\extensions\third-party\paintai\chat.js
extension\scene.js     -> <你的酒馆目录>\public\scripts\extensions\third-party\paintai\scene.js
extension\style.css    -> <你的酒馆目录>\public\scripts\extensions\third-party\paintai\style.css
server-plugin\index.mjs -> <你的酒馆目录>\plugins\paintai-bridge\index.mjs
server-plugin\config.json -> <你的酒馆目录>\plugins\paintai-bridge\config.json
```

在 `<你的酒馆目录>\config.yaml` 中确认：

```yaml
enableServerPlugins: true
```

## 6. 配置服务地址和 Token

重启后打开“扩展程序”中的“PaintAI 出图”，填写：

```text
服务地址： https://www.r67831767.nyat.app:19088
项目 Token：粘贴 PaintAI 网站签发的 JWT
```

服务地址必须是 HTTPS 根地址，不要追加 `/api`、`/api/tokens/check` 或其他路径。点击“检查连接 / 额度”确认桥接和 Token 状态；额度检查不会提交出图请求。

## 7. 手动生成图片

在 PaintAI 面板填写画面提示词并点击“生成图片”，或在聊天中输入：

```text
/paintai 1girl, garden, sunlight, anime style
```

插件当前支持单张文生图、NovelAI 4.5 Full / Curated、五种预设尺寸、1–28 步和 CFG 1–30。取消或失败不保证上游退还已经扣除的额度。

## 8. 配套世界书

仓库中已经提供适配本插件的世界书：

```text
worldbook/paintai-worldbook.json
```

也可以从 GitHub 下载：

```text
https://raw.githubusercontent.com/yishiyi2194/-15151/main/worldbook/paintai-worldbook.json
```

导入步骤：

1. 在酒馆打开“世界书”管理界面。
2. 选择导入 JSON 文件，导入 `paintai-worldbook.json`。
3. 将世界书绑定到当前角色、群组或全局世界书，并启用它。
4. 首次测试时保持“检测到图片标签后自动生成”关闭。
5. 让 AI 在确实需要插图时输出一行：

```text
[[paintai: 1girl, white dress, garden, sunlight, anime style]]
```

世界书只负责提醒模型生成英文画面标签；插件只识别明确图片标签，不会把普通聊天全文当成提示词。支持：

```text
[[paintai: ...]]
[[绘图: ...]]
【文生图】...
<paintai>...</paintai>
```

确认标签格式正确后，再打开自动开关。普通聊天不会因为出现“图片”二字就自动扣额度。

## 9. 手机和其他设备

### 手机访问同一台酒馆

如果手机和电脑访问的是同一个 SillyTavern 服务器，只需在服务器上安装一次两部分插件。手机浏览器打开酒馆地址，不要打开 `127.0.0.1`。

### 手机运行独立酒馆

如果手机运行的是独立 SillyTavern，每个实例都要安装前端和服务端桥接。安卓可以用 Termux 运行 Node.js；iPhone 不适合长期运行 Node.js 服务，建议使用云服务器。

### 局域网访问

电脑需要监听局域网地址并放行酒馆端口。例如酒馆端口是 `8000`，手机可能使用：

```text
http://电脑局域网IP:8000/
```

公网访问时应使用 HTTPS 反向代理，并允许 WebSocket 和 SSE 长连接。不要直接把未加密的酒馆端口暴露到公网。

## 10. 更换 PaintAI 网站

服务端只允许 `config.json` 中的精确 HTTPS 来源。默认文件内容为：

```json
{
  "allowedOrigins": ["https://www.r67831767.nyat.app:19088"]
}
```

如果使用其他 PaintAI 网站，将它改成不带路径、查询参数和片段的完整根地址，保存后重启酒馆。面板中的服务地址必须与这里完全一致。

## 11. 常见问题

### 扩展面板没有 PaintAI

确认前端目录下存在 `manifest.json` 和 `index.js`，然后重启酒馆并刷新浏览器。

### 服务端插件未加载

确认 `plugins\paintai-bridge\index.mjs` 存在、`enableServerPlugins: true` 已开启，并且已经完全重启酒馆。浏览器刷新不会重新加载 Node.js 服务端插件。

### 地址不在允许列表

检查 `plugins\paintai-bridge\config.json` 的 `allowedOrigins`，域名、HTTPS 和端口必须完全一致。

### Token 无效或额度不足

回到 PaintAI 网站检查 Token 是否过期、被撤销或额度耗尽。插件不会绕过网站校验，也不会自动更换 Token。

### Git URL 安装失败

确认运行 SillyTavern 的服务器能访问 GitHub，并检查 `public\scripts\extensions\third-party` 下是否已有同名目录。网络受限时使用 ZIP 和 PowerShell 安装脚本。

## 12. 卸载

关闭酒馆后删除：

```text
<你的酒馆目录>\public\scripts\extensions\third-party\paintai
<你的酒馆目录>\plugins\paintai-bridge
```

不要因为卸载 PaintAI 而关闭其他插件需要的全局服务端开关。
