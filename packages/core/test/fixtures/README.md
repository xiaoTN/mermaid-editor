这些 SVG 是仓库锁定的 **Mermaid 11.16.0** 直接渲染的结果，未手工调整路径顺序、id 或标签结构。

- `louvre.mmd`：来自本次任务的 `.codex-runs/louvre.mmd`，保留全部原始字节。
- `edge-forms.mmd`：补充中文平行边、文字标签、自定义边 id、& 展开、链式边与 linkStyle。
- `*.svg`：由 `npx tsx tools/cases/render-fixtures.mts` 重新生成。jsdom 只补齐 SVG 文字测量 API，测试验证身份对应及文本编辑，不验证布局坐标。

Mermaid 11 的 path 是 `${diagramId}-${edgeId}`，并携带 `data-id="${edgeId}"`；标签外层为 `.edgeLabel`，其内部 `g.label[data-id]` 指向同一个 edgeId。嵌套分组会重排路径及标签，平行边的数字后缀可能不连续，不能把绘制次序作为源码边序。
