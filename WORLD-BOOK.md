# PaintAI 世界书使用方法

## 世界书文件

世界书文件在：

```text
worldbook/paintai-worldbook.json
```

也可以直接下载：

```text
https://raw.githubusercontent.com/yishiyi2194/-15151/main/worldbook/paintai-worldbook.json
```

## 第一步：导入

打开 SillyTavern 的“世界书”管理界面，选择“导入”，选中 `paintai-worldbook.json`。

## 第二步：启用

把导入的世界书绑定到当前角色、群组或全局世界书，并打开启用开关。

## 第三步：先手动测试

先不要打开“检测到图片标签后自动生成”。让 AI 在需要图片时输出：

```text
[[paintai: 1girl, white dress, garden, sunlight, anime style]]
```

然后点击 PaintAI 面板的“读取最近 AI 回复”，确认提示词后点击“生成图片”。

## 第四步：打开自动出图

确认手动出图正常后，再打开“检测到图片标签后自动生成”。之后 AI 回复中出现明确的 PaintAI 图片标签时，插件会自动出图。

支持的标签格式：

```text
[[paintai: ...]]
[[绘图: ...]]
【文生图】...
<paintai>...</paintai>
```

普通聊天文字不会自动出图，避免误扣额度。世界书只负责提醒 AI 输出提示词，真正出图仍需要 PaintAI 前端扩展、服务端桥接和有效 Token。
