<div align="center">

# Mermaid 编辑器

**AI 画好了 Mermaid，想改一个节点，却要重新读懂整段代码？**

让 AI 负责画图，你在画布上直接微调。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform: Web & Windows](https://img.shields.io/badge/Platform-Web%20%26%20Windows-4c6ef5)
![Language: 中文 & English](https://img.shields.io/badge/Language-中文%20%26%20English-4c6ef5)

[快速开始](#快速开始) · [主要功能](#主要功能) · [Windows 桌面版](#windows-桌面版) · [English](README.en.md)

</div>

![Mermaid 编辑器：左侧源码，右侧实时画布](docs/screenshots/editor-zh.png)

## 为什么用它？

- **不用反复改语法**：直接在画布上编辑节点、连线和分组。
- **不用担心源码脱节**：画布与 Mermaid 文本双向同步，修改尽量保留原有写法。
- **不用上传文件**：浏览器版和 Windows 桌面版均可在本地使用。

## 快速开始

需要 Node.js 和 pnpm（项目使用 `pnpm@10.33.0`）：

```bash
pnpm install
pnpm dev
```

打开 <http://localhost:5173>，粘贴 Mermaid 代码，或打开 `.mmd`、`.mermaid`、`.md`、`.txt` 文件。首次使用可直接试用内置示例。

## 主要功能

| 功能 | 操作 |
| --- | --- |
| 节点与连线 | 双击改文字，拖动连接点连线，调整形状、颜色和线型 |
| 分组与排版 | 框选建组、拖动节点或整组、调整分支顺序，并预览排版 |
| 源码与画布 | 双向同步、复制源码、切换方向，支持撤销和重做 |
| 文件与草稿 | 本地打开和保存，保留草稿；Markdown 中仅编辑第一个完整 Mermaid 代码块 |
| 语言 | 中文 / English 界面，支持中文节点 ID |

## Windows 桌面版

需要 Microsoft Edge WebView2 Runtime。构建前请准备 Go 工具链（脚本使用 Go 1.24.4）和前端依赖：

```powershell
pnpm install
.\tools\windows\build.ps1
```

构建后运行 `dist/mermaid-editor.exe`。桌面版支持直接打开、保存文件，并在保存时检查外部修改。

## 当前范围

- 画布可视化编辑目前支持流程图；其他图表可编辑源码并实时预览。
- Mermaid 自动计算布局。自由拖动只影响当前显示；分组移动和支持的排序操作可改写源码。
- 草稿用于恢复编辑现场，正式文件仍需主动保存。

## 开发检查

```bash
pnpm test
pnpm typecheck
pnpm --filter playground build
```

## 许可证与致谢

基于 [inkeep/mermaid-wysiwyg](https://github.com/inkeep/mermaid-wysiwyg) 构建，以 [MIT License](LICENSE) 发布。
