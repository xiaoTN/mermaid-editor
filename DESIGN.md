---
version: alpha
name: Mermaid 绘图工作台
description: 让源码和图形保持对话的本地编辑工作台。
colors:
  primary: '#315fd6'
  background: '#eef2f8'
  surface: '#ffffff'
  ink: '#25334a'
  muted: '#627189'
  border: '#d9e1ed'
typography:
  display:
    fontFamily: 'Avenir Next, Segoe UI, sans-serif'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif'
  mono:
    fontFamily: 'SFMono-Regular, Cascadia Code, Consolas, monospace'
rounded:
  control: '7px'
  panel: '12px'
spacing:
  page: '24px'
  panel: '18px'
components:
  button:
    rounded: '7px'
  panel:
    rounded: '12px'
---

# Mermaid 绘图工作台

## Overview

面向需要梳理业务流程、维护 Markdown 流程图的中文用户。依据 README.md 的产品说明，主任务是编辑同一份 Mermaid 文本并即时观察图形。浏览器和 Windows WebView2 共用本界面，中英文通过 packages/dom/src/i18n 切换。不引入在线服务或外部字体。

视觉北极星是绘图工作台：两张相连的工作纸，一张写源码，一张整理流程。辨识点是由流程节点组成的蓝色标记，以及源码和画布相互对应的标题、底栏。保持图表本身最大的信息权重，不使用营销大标题、暗色霓虹或装饰性数据卡片。

运行时采用 Model B：apps/playground/src/app.css 的 :root 变量是色彩、字体和圆角的唯一运行时来源；本文件记录主要值和意图。其他演示入口 mermaidraw 是展示站，保留它自己的品牌外观，不将其营销样式移入日常编辑器。

## Colors

雾蓝 background 承托白色 surface，石墨 ink 用于主要文字，muted 用于次要信息。primary 只用于保存、选中、焦点和结构图标。状态颜色另由 --color-success、--color-danger、--color-warning 定义，必须同时带文字或图标。浅色为当前唯一主题，forced-colors 恢复系统滚动条和焦点颜色。

## Typography

Avenir Next 仅用于 Mermaid 标识，缺失时使用 Segoe UI。正文采用系统中文字体，控件 12–13px，标识 23px，源码采用 12px 等宽字体与 2.1 行高。无需网络字体，避免启动时文字位移。英文文案允许工具栏换行。

## Layout

桌面顶部为品牌、文档名、文件操作和语言选择。第二行仅承担绘图工具。主区域为 32% 源码、24px 收起控制和剩余画布。面板固定标题与底栏，中部独立滚动或平移。高度沿用现有全屏编辑器约定，短视口允许文档自然溢出。

1100px 下收紧边距并省略辅助文案；700px 下上下排列源码和画布，工具栏换行。收起源码保留 CodeMirror 实例和历史。文件名截断保留 title，全称也显示在窗口标题中。

## Elevation & Depth

面板以边界和浅色差区分，阴影很轻。反馈浮层用更明确阴影。避免为每个工具按钮单独添加卡片或阴影。

## Shapes

控件使用 7px 圆角，面板使用 12px 圆角。标记来自流程图的矩形节点和折线，图标使用一致的 1.6px 描边，默认 17px。画布保留 20px 点阵辅助空间感。

## Components

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Scrollbar | app.css 全局基线 | README.md、本文 Components | 标准属性与 WebKit 回退，thumb/track/hover/active 变量；CodeMirror 稳定滚动槽 | 浏览器计算样式与窄屏 |
| Toast | App.tsx 的 toast 状态与 packages/dom notices | README.md、本文 Components | 保留文件操作反馈和画布反馈，role=status；浮层不改变布局 | 复制与错误场景 |
| 文件操作 | App.tsx、files.ts、draft.ts、desktop.ts | README.md、本文 Components | 浏览器下载，桌面系统文件对话框；遵循 README.md | 既有文件/草稿测试 |
| 图形交互 | MermaidCanvasView 与 MermaidWysiwygEditor | README.md、本文 Components | 流程图可编辑，其他类型预览；源码提供键盘替代路径 | 浏览器增删与撤销 |
| 按钮 | App.tsx Button | README.md、本文 Components | 原生按钮，文字标签和可选 Icon；保存为实色，其余轻量 | 焦点、悬浮、禁用与双语 |

主要颜色 `colors.<name>` 对应 `--color-<name>`；字体 `typography.<name>` 对应 `--font-<name>`；圆角 `rounded.<name>` 对应 `--radius-<name>`。Button、面板、CodeMirror 和画布 chrome 消费 CSS 变量；Mermaid 主题在初始化时从同一变量读取。页面留白为 24px，面板内边距为 18px。

源码与画布标题是普通标题行，不伪装成选项卡。语言按钮使用 aria-pressed。撤销/重做和非流程图工具延续原有禁用逻辑。错误保留最近可见画布，并在底栏文字提示，不用颜色独自传达错误。提示沿用可关闭的新手说明。

仅控件悬浮使用 150ms 色彩过渡，减少动态效果偏好下关闭过渡。新图保留原有撤销和草稿规则，不增加确认步骤。源文件同步、存储和外部冲突处理不因视觉改造而改变。

节点和分组拖动共用主画布内的排版对照，不再显示缩略图窗口。旧位置以灰色虚线保留，新布局用蓝色实线突出；只重复被移动对象、排序对象、相关父组边界及连线，其他内容只绘制新排版。对照共用主画布的倍率，以未移动的入口节点对齐，缩放和平移时同步更新。预览不显示“移动前 / 移动后”的浮动标签和顶部图例，顶部只保留预览标题和“仅看移动后”开关，底部是计算、可应用或无法满足顺序的文字状态，菜单入口另外显示应用和取消按钮。正式源码与撤销历史只在预览成功、松手或点击“应用排版”时修改一次；Esc、离开画布、源码变化、只读切换或过期结果不能提交。预览副本不参加命中、框选、分组检测或键盘选择，主 SVG 保留原有落点坐标，取消后恢复原图。副本的 ID、箭头和样式引用独立，视觉强调不修改源码配色。

整组拖动复用同一个预览和提交过程。从组标题、边框或空白开始，内部节点、子组及内部连线一起跟随指针，取消时全部恢复原位置；从内部节点开始仍只拖该节点。目标可为其他组、父组外或同层并列组的前后。分组菜单提供“整组前移/后移”和“移动整组”，后者使用已有浮层面板列出合法的父级目标。禁止循环包含及分组与祖孙成员间的连线；源码的分组声明顺序只是排版提示，应用前必须检查实际画面中的顺序。

拖动节点或组时，跨边界的连线实时跟随移动端，组外的另一端固定，连线文字随中段移动。保留线型和箭头，只修改临时画面；采样原有曲线并平滑变形，不在每次指针移动时重新计算全图。组内连线整体平移，嵌套元素不能重复位移。取消时恢复原始路径和文字位置，预览就绪后仍展示实际自动排版，松手沿用同一份已验证结果。

整个可见画布都是节点和组的拖动范围，图形原始尺寸不构成内部裁切边界。排序依据指针在排列方向上的位置，允许从远离原行列的空白处绕行；进入其他组时优先预览归组。只有实际离开画布或落在交互控件上才视为无效落点，正式位置仍由 Mermaid 自动排版决定。

松手或点击应用时，已经验证的新图与源码在同一次操作中接管正式画布，不重新计算同一份排版。关闭对照后不能露出旧图；排队中的重复渲染和计算中的过期结果都要作废。正式画布重新绑定选择、连线和文字编辑，继续沿用原有撤销历史。

从连接点拉线到画布空白处，松手直接创建节点并连接，不显示中间菜单；渲染后自动聚焦并选中新节点文字。节点和连线合为一次可撤销操作。已有目标继续直接连线，Esc、指针取消、只读、画布外或控件上松手，以及只点击连接点，都不创建节点。

## Do's and Don'ts

- 保留可见的文字标签、键盘焦点和状态提示。
- 新文案放进已有中英文字典，不创建页面私有翻译系统。
- 遵循运行时变量到组件的单一映射，避免在主题里重复硬编码。
- 不自动修改用户图表，不把草稿误称为已保存文件。默认功能示例集中维护在 defaultExample.ts；首次打开且无旧草稿时展示，也可通过“示例”载入。载入时沿用新文档的草稿隔离和撤销规则，“新建”继续创建空白图。
