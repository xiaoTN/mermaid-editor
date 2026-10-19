// 用法: node check.mjs 文件.mmd            -> 只校验能否被 mermaid 解析
//       node check.mjs 原始.mmd 改后.mmd    -> 解析 + 列出改动的行（其余行必须字节一致）
import { JSDOM } from 'jsdom';
import fs from 'fs';
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.DOMPurify = undefined;
const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false });
const [a, b] = process.argv.slice(2);
const target = b || a;
const src = fs.readFileSync(target, 'utf8');
try { const r = await mermaid.parse(src); console.log(`解析通过: ${target} (${r.diagramType})`); }
catch (e) { console.log(`解析失败: ${target}\n  ${String(e.message || e).split('\n').slice(0,3).join('\n  ')}`); process.exitCode = 1; }
if (b) {
  const A = fs.readFileSync(a, 'utf8'), B = src;
  if (A.includes('\r\n') !== B.includes('\r\n')) { console.log('换行符变了 (CRLF/LF)'); process.exitCode = 1; }
  if (A.endsWith('\n') !== B.endsWith('\n')) console.log('文件末尾换行变了');
  const la = A.split(/\r?\n/), lb = B.split(/\r?\n/);
  // LCS 行级 diff
  const n = la.length, m = lb.length, dp = Array.from({length: n+1}, () => new Int32Array(m+1));
  for (let i = n-1; i >= 0; i--) for (let j = m-1; j >= 0; j--) dp[i][j] = la[i] === lb[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  let i = 0, j = 0; const out = [];
  while (i < n || j < m) {
    if (i < n && j < m && la[i] === lb[j]) { i++; j++; }
    else if (j < m && (i >= n || dp[i][j+1] >= dp[i+1][j])) out.push(`+ ${j+1}: ${JSON.stringify(lb[j++])}`);
    else out.push(`- ${i+1}: ${JSON.stringify(la[i++])}`);
  }
  console.log(`改动 ${out.length} 行${out.length ? '：\n' + out.join('\n') : ''}`);
}
