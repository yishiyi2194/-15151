# PaintAI 酒馆安装使用教程

这套插件需要安装两部分：前端扩展和 Node.js 服务端桥接。最简单的方式是下载 ZIP，用安装脚本一次安装。

## 第一步：准备

确认电脑已经安装：

- SillyTavern 1.13.3 或更高版本
- Node.js 20 或更高版本

下载并解压本项目 ZIP。记住你的 SillyTavern 根目录，例如：

```text
D:\Apps\SillyTavern
```

## 第二步：安装插件

在解压后的插件目录打开 PowerShell，执行下面命令。把路径换成你自己的酒馆目录：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TavernRoot 'D:\Apps\SillyTavern'
```

安装脚本会自动复制前端、复制服务端桥接，并开启 `enableServerPlugins`。

## 第三步：重启酒馆

完全关闭 SillyTavern，再重新启动。只刷新网页不够，因为服务端插件必须随酒馆进程启动。

## 第四步：填写 PaintAI 地址和 Token

打开酒馆的“扩展程序” → “PaintAI 出图”，填写：

```text
服务地址：https://www.r67831767.nyat.app:19088
项目 Token：粘贴 PaintAI 网站签发的 Token
```

服务地址不要追加 `/api`。然后点击“检查连接 / 额度”。

## 第五步：生成图片

在“画面提示词”中填写内容，点击“生成图片”。也可以在聊天中输入：

```text
/paintai 1girl, garden, sunlight
```

## 第六步：需要自动出图时导入世界书

世界书是单独的文件，导入方法见 [`WORLD-BOOK.md`](WORLD-BOOK.md)。首次使用时，建议先不要打开自动出图，确认手动生成正常后再打开。

## Git URL 安装说明

也可以在酒馆扩展安装器中粘贴：

```text
https://github.com/yishiyi2194/-15151.git
```

这只会安装前端扩展，服务端桥接仍要用安装脚本安装。两个部分都安装后才能出图。

## 手机使用

- 手机访问已经安装桥接的那台酒馆服务器，不需要在手机浏览器里重复安装桥接。
- 如果手机和电脑运行两个独立 SillyTavern，两个实例都要分别安装完整插件。
- 安卓可以用 Termux 运行酒馆；iPhone 建议使用云服务器运行酒馆。

## 常见问题

### 没有 PaintAI 面板

重启酒馆并刷新网页，确认前端目录中有 `manifest.json` 和 `index.js`。

### 服务端插件未加载

确认酒馆配置中有：

```yaml
enableServerPlugins: true
```

然后完全重启酒馆。

### 地址不在允许列表

打开酒馆的 `plugins/paintai-bridge/config.json`，确认 `allowedOrigins` 中有完整的 PaintAI HTTPS 根地址。

### Token 无效

回到 PaintAI 网站检查 Token 是否过期或额度不足。插件不会绕过网站校验。
