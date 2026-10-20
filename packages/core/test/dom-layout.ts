/// <reference lib="dom" />
// jsdom 没有文字布局；让 CodeMirror 的异步测量能够执行。真实坐标、
// 可见区域与滚动位置由 tools/windows/louvre-smoke.mts 验证。
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
