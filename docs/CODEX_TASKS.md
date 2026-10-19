# Mermaid 编辑器 0.1：给 codex 的任务拆分

- 写于：2026-10-19（北京时间）。作者是研发。这份文档只做了只读分析，没有写产品代码。
- 底子：fork 自 https://github.com/inkeep/mermaid-wysiwyg（MIT），参考提交 `0d21103`，分支 `main`。
- 文中的行号都对应这个提交，并且是**打 44 行中文 ID 补丁之前**的行号。打完补丁后，parse.ts 里的行号基本不变，因为补丁只改了正则，行数没变。
- 测试资料来自测试：`samples\`（11 个图）、`CASES.md`（27 条用例）、`check.mjs`、`mw-run.mts`、`mw-chinese-id.patch`。**这些文件一个字都不能改**。

## 0. 研发在自己电脑上实测的起点（打完中文 ID 补丁后）

| 项目 | 结果 |
|---|---|
| `git apply --check mw-chinese-id.patch` | 能干净打上 |
| `pnpm -r run test` | core 74 个通过，dom 6 个，codemirror 6 个，monaco 7 个，全部通过 |
| `06-edge-cases` | `x1 e1@--> x2`（第 4 行）和 `C1 --> D1; D1 --> E1`（第 7 行）都被当成 unknown；`e1@{ animate: true }` 被误认成一个叫 `e1` 的**节点** |
| `05-shapes-multi` | 第 10–11 行是跨两行的 markdown 文字 `` "`…`" ``，被当成 unknown，所以节点 M 和边 K→M 都丢了 |
| `11` 删 B→C（用例 24） | `linkStyle 1,3` 整行被删，**错**。应该是 `linkStyle 2` |
| `11` 删 A→C（用例 25） | 变成了 `linkStyle 0,3`，**错**。应该是 `0,2` |
| 改名时文字里带 `"` | 被换成 `'`，**错** |
| `07` CRLF 文件里新增一行（connect/addNode） | 新行的结尾是单独的 `\n`，换行符混了，**错**（用例 17） |
| `deleteNode` | 会把 class/style/click 行也删掉或改掉。**和团队规则不一致**：规则是这些行只给提示，不自动删 |

---

## A. 那台电脑（XiaoTN-Home，Windows）的准备工作

下面的命令都在 **PowerShell** 里运行，小T 每一步都要点批准。

### A1. Go 1.24.4（从国内镜像下载，不用从研发电脑传文件）
```powershell
$zip = "$env:USERPROFILE\Downloads\go1.24.4.windows-amd64.zip"
Invoke-WebRequest https://golang.google.cn/dl/go1.24.4.windows-amd64.zip -OutFile $zip
(Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
# 必须等于 b751a1136cb9d8a2e7ebb22c538c4f02c09b98138c7c8bfb78a54a4566c013b1，对不上就停下，不要解压
New-Item -ItemType Directory -Force "$env:USERPROFILE\sdk" | Out-Null
Expand-Archive $zip -DestinationPath "$env:USERPROFILE\sdk" -Force   # 解压后是 %USERPROFILE%\sdk\go
[Environment]::SetEnvironmentVariable('Path', "$env:USERPROFILE\sdk\go\bin;" + [Environment]::GetEnvironmentVariable('Path','User'), 'User')
$env:Path = "$env:USERPROFILE\sdk\go\bin;$env:Path"
go env -w GOPROXY=https://goproxy.cn,direct
go env -w GOTOOLCHAIN=local
go version   # 应该显示 go1.24.4 windows/amd64
```

### A2. Node / pnpm
Node 24 已经装好了。registry.npmjs.org 目前能连上，所以先用默认源。如果连不上，再换成国内源：
```powershell
node -v
npm ping                                   # 失败时执行下一行
# npm config set registry https://registry.npmmirror.com
npm install -g pnpm@10.33.0                # 版本和上游的 packageManager 一致；如果 corepack 能用，也可以 corepack enable
pnpm -v
# pnpm 也连不上默认源时：pnpm config set registry https://registry.npmmirror.com
```

### A3. 仓库
mermaid-wysiwyg 是公开仓库，在 GitHub 上没法直接 fork 成私有仓库。所以做法是：先 clone 下来，再推到小T 名下新建的私有仓库。
```powershell
gh auth status          # 需要已经用 xiaoTN 登录；没登录的话，要小T 自己登录，或者改由研发在自己电脑上建仓库
gh repo create xiaoTN/mermaid-editor --private --description "离线 Mermaid 可视化编辑器（fork 自 inkeep/mermaid-wysiwyg，MIT）"
git clone https://github.com/inkeep/mermaid-wysiwyg D:\Projects\mermaid-editor
cd D:\Projects\mermaid-editor
git checkout 0d21103 -b master             # 和参考提交对齐，分支名用 master
git remote rename origin upstream
git remote add github https://github.com/xiaoTN/mermaid-editor.git
# LICENSE 保持原样（MIT, Inkeep）。README 开头加一段来源说明，见 6.6
New-Item -ItemType Directory testdata | Out-Null
# 把测试的资料复制到 testdata\：samples\、CASES.md、check.mjs、mw-run.mts、mw-chinese-id.patch、package.json、package-lock.json（不复制 node_modules 和 out）
cd testdata; npm ci; cd ..                 # 给 check.mjs 装上 mermaid 11 和 jsdom
pnpm install
pnpm add -Dw tsx
pnpm -r run test                           # 基线：core 74 个、dom 6 个、codemirror 6 个、monaco 7 个，应全部通过
```
`.gitignore` 里加上 `testdata/node_modules/`、`testdata/out/`、`out/`。

每次提交都用：`git -c user.name=小梯 -c user.email=x@t commit -m "..."`。推送用 `git push github master`，**不许 force push**。

### A4. 通用验证命令（每一步做完都要跑）
```powershell
cd D:\Projects\mermaid-editor
pnpm --filter @inkeep/mermaid-wysiwyg-core test      # core 单元测试
pnpm -r run test                                      # 所有包
npx tsx testdata\mw-run.mts                           # 测试的探针脚本，结果写到 testdata\out\
npx tsx tools\cases\run-cases.mts                     # 27 条用例（第 1 步建好，后面每步补充）
# 单独核对某一条：
node testdata\check.mjs testdata\samples\11-linkstyle-split.mmd out\cases\c24.mmd
```

---

## 给 codex 的通用要求（每条提示词前面都要加上）

> 你在 D:\Projects\mermaid-editor 工作。这个仓库 fork 自 inkeep/mermaid-wysiwyg，是 pnpm monorepo，核心代码在 packages/core/src。
> 规则：
> (1) 画布上的每次操作都要编译成**最小的文本改动**（TextEdit）。没改的行必须字节一致：缩进、tab、注释、CRLF、行尾空格、行的顺序都不能动。
> (2) 撤销要能字节一致地回到原样。现有的 applyEdits 和逆操作机制已经能保证这一点，不要绕开它。
> (3) testdata\ 目录只能读，不能改。
> (4) 新功能都要在 packages/core/test/ 里加 vitest 用例，现有的 74 个必须继续通过。
> (5) 给用户看的文字一律用中文。
> (6) 做完以后运行 `pnpm -r run test` 和 `npx tsx tools\cases\run-cases.mts`，把输出贴出来。

---

## 第 1 步：打中文 ID 补丁，再验证一遍，建好用例运行器

**要改的文件**
- `packages/core/src/flowchart/parse.ts`：补丁会改第 132 行的 `ID_CHAR`、第 169 行 `parseNodeRef` 里的循环（连字符只在两个 ID 字符中间时才算进 ID）、第 385/397/400 行的 `class`/`style`/`click` 正则。
- 新建 `tools/cases/run-cases.mts`：27 条用例的运行器。
- 新建 `packages/core/test/zh.test.ts`。

**codex 提示词**
> 1. 运行 `git apply testdata\mw-chinese-id.patch`，然后跑 `pnpm -r run test`，确认 74 个 core 测试都通过。
> 2. 新建 packages/core/test/zh.test.ts：读 testdata/samples/01-chinese-basic.mmd，断言解析出 5 个节点（开始、输入、校验、首页、报错）和 5 条边；renameNode('校验') 只改第 3 行，`{}` 保留；对「校验→首页」做 setEdgeLabel('通过') 只改第 4 行，`-->|…|` 写法保留；06 样例里的 `id-1` 是一个节点。
> 3. 新建 tools/cases/run-cases.mts。从 packages/core/src/index.ts 导入 MermaidWysiwygEditor，给 CASES.md 的每一条（1–27）写一个函数：读样例 → 用 dispatch/deleteEntities 执行对应操作 → 把结果写到 out/cases/cNN.mmd → 用 child_process 调 `node testdata/check.mjs 原始 改后` → 再断言「允许改动的行」(LCS 行 diff，只允许出现预期的行号和预期的新行内容) → 撤销到底，比较字节 → 最后打印「用例 NN：通过/失败（原因）」。用到本步还没实现的 op（例如 retargetEdge）的用例，先标「待实现」，不算失败。退出码等于失败的条数。
> 4. 用例 18（只读）、19（大图性能）里属于界面的部分在运行器里只检查核心部分：18 检查 detectDiagramType 是 sequence/gantt；19 是在 10-large 上连做 20 次 setEdgeLabel 或 connect，再撤销 20 次，要求字节一致，总耗时 < 2s。

**验收**：74 个旧测试 + zh.test.ts 全部通过；运行器能跑。下面这些用例这一步就应该通过：2、3、5、7、8（8 的 class/style 提示规则在第 5 步再严格检查）、18、19、20。

---

## 第 2 步：一行写多条语句（`;`）、边的 id `e1@-->`、跨行 markdown 文字、CRLF 新增行

**现状和位置**
- `LineParser` 的构造函数（parse.ts 第 141–152 行）只去掉**行尾**的 `;`。一行中间出现 `;` 时，`parseEdge`（第 275 行）就会失败，整行被当成 unknown（第 431 行）。
- 主循环（第 411–427 行）在 `skipWs` 之后直接调 `parseEdge`。遇到 `e1@-->` 时，第 278 行的正则匹配不上。
- `graph.ts` 的 `statements: Map<number, FlowStmt>`（第 66/76/113 行）是按「一行一条语句」设计的，边的 `lineIndex` 也一样（第 145 行）。
- `e1@{ animate: true }` 这一行会被 `parseNodeRef` 里第 222–229 行的 `@{` 分支当成节点的属性，于是凭空多出一个节点 `e1`。
- `ops.ts` 的 `insertLinesAfter`（第 66 行）、`replaceLineEdit`（第 78 行）、`rebuildChain` 都写死用 `\n`。`scanLines`（text.ts 第 4–19 行）只按 `\n` 切行，所以 CRLF 文件里 `line.text` 的末尾带着 `\r`。

**codex 提示词**
> A. **换行符**：在 ops.ts 里加 `eolOf(ctx)`：代码里出现 `\r\n` 就返回 `\r\n`，否则返回 `\n`。再加 `lineBody(line)`，返回去掉末尾 `\r` 以后的范围 `{start, end}`。把 insertLinesAfter / replaceLineEdit / deleteLineEdit 都改成按 eol 处理：新行要用和文件相同的换行符；替换时不能吃掉原来的 `\r`；删除一行时，连同它的完整换行一起删掉。另外加 `insertLinesBefore(ctx, lineIndex, texts)`，第 5 步要用。scanLines 不要改，因为 core.test 第 12 行要求它无损。
> B. **语句切分**：在 parse.ts 里加 `splitStatements(line)`。它在引号 `"…"`、反引号字符串 `` "`…`" ``、各种括号 `[]`、`()`、`{}`、`|…|` 外面遇到 `;` 时切开，返回每一段的 `{start,end}`（绝对偏移，不含分号和两边的空白）。`parseFlowStatement` 改成按段解析，每条语句带上 `span` 和 `stmtIndex`。graph.ts 的 `statements` 改成 `Map<number, FlowStmt[]>`，或者加一个键 `"行号:段号"`。所有用到它的地方（ops.ts 第 211、350、371、377、417、437、470 行，graph.ts，correlate.ts）都要一起改。FlowEdge 加上 `stmtIndex`。`rebuildChain` 和 `replaceLineEdit` 在多语句的行里只替换**那一段的 span**，同一行的其他段和分号一个字节都不动。`B1 --> C1 ;` 这种只是行尾带分号的写法要保持原样。
> C. **边的 id**：在主循环（第 411–427 行）调 `parseEdge` 之前，先试 `/^([\p{L}\p{N}_]+)@(?=[-=.~<xo])/u`。匹配上了就把 id 记到 `EdgeSeg.edgeId`，把 `EdgeSeg.idSpan` 记下来，然后接着解析箭头。`EdgeSeg.span` 仍然**只包括箭头和文字**，不包括 `e1@`。这样 setEdgeStyle、setEdgeLabel 都不会碰到 `e1@`。rebuildChain 里拼接边的文字时，要从 idSpan.start 开始截取，`e1@` 才能原样留下。
> D. **边的属性行**：`^\s*<id>@\{…\}\s*$` 这样的语句，如果 `<id>` 是这张图里某条边的 edgeId，就解析成新的 kind `'edgeAttrs'`，不建节点。graph 要分两遍处理：第一遍先收集所有边的 id，第二遍再分类。deleteEdge 删一条带 id 的边时，对应的 `e1@{…}` 行也一起删掉。
> E. **跨行 markdown 文字**：在一行里 `` "` `` 还没闭合时，把后面的物理行合并成一条逻辑语句，直到遇到 `` `" ``。语句的 span 可以跨行。NodeRef.labelSpan 指向两个反引号之间的内容。graph 把这条语句挂在起始行上，被吞掉的续行标记成 `'continuation'`，ops 一律不碰续行。
> F. 测试（新建 packages/core/test/stmts.test.ts）：06 样例解析出 x1→x2（edgeId=e1）、C1→D1、D1→E1，没有叫 `e1` 的节点；对 `D1 --> E1` 改文字时只改这一段；删掉 `C1 --> D1` 以后第 7 行变成 `    D1 --> E1`；05 样例里节点 M 和边 K→M 都存在；对 07（CRLF）做 connect、addNode、deleteEdge，结果仍然全是 CRLF，第 2 行的行尾空格还在，撤销后字节一致。

**验收（CASES）**：14 和 15 的解析部分（换目标在第 5 步）；16 的一半（第 3 步完成另一半）；17 通过；9 通过（04 里的 `%%{init}%%`、tab、classDef、class、style、click、`linkStyle default` 都保持原样）。

---

## 第 3 步：引号处理（`#quot;`）

**位置**
- ops.ts 第 37–41 行 `printLabel`：`label.replace(/"/g, "'")`
- 第 276 行：renameNode 里带引号的分支也用了同样的替换
- 第 35 行 `NEEDS_QUOTE`：没有考虑 `"`、`end`、`-->`、`--`、`==`、`~~~`
- 第 253、315、334 行：边的文字只去掉了 `|`

**codex 提示词**
> 1. 文字里的 `"` 一律写成 mermaid 的实体 `#quot;`，不要再换成 `'`。原来就有的 `&quot;`、`#35;` 这类实体原样保留，不要二次转义 `#`。
> 2. 扩充 NEEDS_QUOTE：遇到 `"`、`#quot;`，单词 `end`（不区分大小写），以及 `-->`、`---`、`--`、`==`、`-.`、`~~~` 时，就给文字加上 `"…"`。已经带引号的文字（`ref.quoted`）只替换引号里面的内容。
> 3. 边的文字：`|…|` 里如果有 `|`，就写成 `|"a#124;b"|`，或者整个用引号包起来，不能直接把 `|` 删掉。
> 4. renameNode 遇到跨行 markdown 文字（第 2 步 E 的情况）时，只替换反引号之间的内容。
> 5. 测试：在 05 里把 A 改名成 `含 "引号" 和 end`，结果应为 `A["含 #quot;引号#quot; 和 end"]`；把 L 改名，原有的 `&quot;` 和 `#35;` 保持原样；addNode 时分别输入 `end`、`]`、`"`、`-->`，四种结果都要能被 check.mjs 解析通过。

**验收（CASES）**：13 和 16 通过。

---

## 第 4 步：`linkStyle` 序号是逗号列表时的重算

**位置**
- ops.ts 第 209–226 行 `renumberLinkStyles`：正则 `^(\s*linkStyle\s+)(\d+)\b` 只认第一个数字，这就是用例 24、25 出错的根源。
- 第 472 行 setEdgeColor 用的正则也只认一个数字。
- 调用这个函数的地方：connect 第 263 行，deleteEdge 第 359 行，deleteNode 第 391 行。

**codex 提示词**
> 1. 把 renumberLinkStyles 重写成接收 `map(oldIndex) => newIndex | null`，用 `/^(\s*linkStyle\s+)(\d+(?:\s*,\s*\d+)*)(?=\s)/` 匹配。对列表里的每个序号做映射：映射成 null 的去掉；剩下的保持原来的先后顺序，用原来的分隔符 `,` 连起来，只替换序号列表那一段，后面的样式文字不动。列表变空就整行删掉（用第 2 步的 deleteLineEdit，并保留 CRLF）。
> 2. `linkStyle default …` 一律不动。
> 3. 加一个辅助函数 `orderPermutation(before: FlowEdge[], afterCode)`：把改动应用到一份副本上，重新解析，再按边的身份（来源节点、目标节点、在同一行里的第几次出现）对出「旧序号 → 新序号」的对应关系，交给 renumberLinkStyles 用。第 5 步拆行改变顺序时就靠它。connect、deleteEdge、deleteNode 都改成用它，或者继续用现在的算术映射，但结果必须一样。
> 4. setEdgeColor（第 465–486 行）改成：如果这条边的序号在某个列表里，就把它从列表里拿出来，单独写一行新的 linkStyle，列表里的其他序号不受影响。
> 5. 测试（packages/core/test/linkstyle.test.ts，用样例 11）：删 B→C 以后，`1,3` 变成 `2`，`4` 变成 `3`，`0` 不变；删 A→C 以后，`linkStyle 0` 整行删掉，`1,3` 变成 `0,2`，`4` 变成 `3`；在 C 和 D 之间 connect，新边插在第 3 行（`C --> D --> E`）后面，序号是 4，原来的 `4` 变成 `5`；在 E 后面追加的边序号都不变；deleteNode C 以后（删掉第 0、1、2 条边）：`linkStyle 0` 整行删掉，`1,3` 变成 `0`（只剩 D→E），`4` 变成 `1`（E→F）；`linkStyle default` 保持原样；每条都要撤销后字节一致。

**验收（CASES）**：10、24、25、26 通过；27 里属于 24–26 的部分也通过。

---

## 第 5 步：新 op「改边的端点」（retargetEdge），以及删节点时只提示不删

**位置**
- ops.ts 第 5–19 行 `FlowchartOp` 联合类型：加一种 `{ type: 'retargetEdge'; edgeId: string; end: 'source' | 'target'; nodeId: string }`
- 第 21–25 行 `OpResult`：加 `warnings?: string[]`（中文）
- 第 119–198 行 `rebuildChain`：可以复用它的展开、重新拼链和保留独立定义的逻辑
- 第 364–397 行 `deleteNode`：第 376–385 行会删 class/style/click，**要改**
- editor.ts 第 267 行 `dispatch`：要把 warnings 通过事件传给界面
- NodeRef 的 `span` 和 `idSpan` 见 parse.ts 第 75–89 行和第 241–251 行

**规则（项目负责人定的）**
1. 只替换那一个端点的 ID。如果被替换的端点 ref 上带有形状或文字定义（`ref.shape`，比如 `输入 --> 校验{校验通过？}`），就**整段替换 ref.span**，替换成新的 ID，**不能**只换 idSpan，否则会变成 `首页{校验通过？}`。同时，如果这个节点在别处没有形状定义，就在**原行上方**插一行单独的定义 `<缩进>校验{校验通过？}`，把 ref 的原文原样搬过去，包括 `:::class`。
2. 如果这个端点 ref 还被同一条语句里的另一条边用着，就要拆行。有两种情况：链式写法的中间节点，或者 `&` 组里的成员。拆法是：把被改的那条边单独写成一行，**插在原行正上方**，缩进相同，内容是原来的源 ref、原来的箭头（含文字和 `e1@`）、新目标，或者反过来改源。原行用 rebuildChain（dropEdge）重建。例子：在 `C --> D(丁) --> E[(戊)]` 里把 C→D 改到 F，结果是在上方插入 `    C --> F`，原行变成 `    D(丁) --> E[(戊)]`。
3. 只要拆行以后边的顺序变了，就用第 4 步的 orderPermutation 重算所有 linkStyle，保证每个样式还挂在原来那条边上。改到的边本身的样式要跟着这条边走。
4. 不需要拆行的情况就只做一处替换：最后一段的目标、单条边、分号隔开的某一段。
5. 新目标就是原节点、或者新节点不存在时，返回 null，界面上表现为「取消」。
6. deleteNode：连到这个节点的边照删（rebuildChain）。class、style、click 行**不删也不改**，只返回提示，比如 `「class a4,a5 cold」第 15 行还引用着已删除的节点 a4，请手动处理`。

> ⚠ 和 CASES.md 第 22 条的措辞冲突：第 22 条写的是 A→C 拆出来「单独放在原行紧下面」。项目负责人后来对链式写法定的是「插在上面」，这样边的顺序不变。本方案统一用**上方**：A→C 本来就是第 0 条边，放在上面以后顺序不变，`linkStyle 0` 和 `1,3` 都不用改。第 22 条的验收按语义判断：红色仍在 A→F 上，绿色仍在 B→C 和 D→E 上，A、B 的形状不丢，能被 check.mjs 解析。**请测试把第 22 条的措辞改成「上面」，或者确认接受这样做。**

**codex 提示词**
> 在 ops.ts 里实现 retargetEdge，规则按上面 1–6 条。实现顺序：
> (a) 在 FlowEdge 上找到 sourceRef、targetRef（graph.ts 里已经有了）和它所在的语句 stmt。
> (b) 判断要不要拆行：把这个 ref 展开成边，看它是否还属于同一条语句里的另一条边。
> (c) 不用拆行时：如果 ref.shape 存在，并且这个节点在别处没有形状定义，就替换 ref.span，再在上方插入定义行；否则只替换 idSpan。
> (d) 需要拆行时：新行写在上方（用 insertLinesBefore），原行或原来那一段用 rebuildChain({dropEdge}) 重建。如果语句在一个多语句行里（第 2 步），拆出来的新行仍然插在物理行的上方。
> (e) 用 orderPermutation 生成 linkStyle 的改动。
> (f) created 返回新的 edge entityId，让界面能保持选中。
> deleteNode 去掉第 376–385 行的删除逻辑，改成生成 warnings。editor.dispatch 发出 `warning` 事件。
> 测试写在 packages/core/test/retarget.test.ts，覆盖下面列出的验收用例，每条都要检查撤销后字节一致。

**验收（CASES）**
- 1、21：`    校验{校验通过？}` 插在原行上面，原行变成 `    输入 --> 首页`，渲染出来「校验」仍是菱形。
- 4：对 `-.->`、`==>`、`--o`、`<-->`、`~~~` 这几条边改目标，只动那一行，箭头样式不变。
- 11：在 `A & B --> C` 里改 A→C，只拆出 A，B→C 不受影响。
- 12：在 `A --> B --> C` 里改 B→C 的目标，只替换 C。
- 14：`x1 e1@--> x2` 改目标后，`e1@` 和 `e1@{…}` 都还在。
- 15：`C1 --> D1; D1 --> E1` 里改第二段，第一段和分号保持原样。
- 22、23。
- 27：22、23 撤销后字节一致。
- 8：删 SVC 以后，子图和 end 都不乱，有提示，没有删掉任何 class/style 行。

---

## 第 6 步：Vite 单文件页面 + Go/WebView2 外壳

### 6.1 前端（新建 `apps/mermaid-editor`）
可以参考 `apps/js-playground`（vite.config.ts 和 src/main.ts，416 行）。复用 `packages/dom` 里的 `MermaidCanvasView`（view.ts 第 189 行起），按下面几处修改：
- `vite-plugin-singlefile`，`build.assetsInlineLimit` 设成一个很大的值，`build.cssCodeSplit=false`。mermaid 打进包里，不从任何 CDN 加载，也不去掉 zenuml 以外的图类型。构建产物是一个 `dist/index.html`，构建完用 `Select-String "https?://" dist\index.html` 检查，不能有外部脚本或样式。
- 布局：左边是代码编辑框（CodeMirror，用 packages/codemirror；或者用 textarea），设 `aria-label="代码"`；右边是画布，两边实时双向同步。
- 工具栏的按钮都要有 aria-label：「打开」「保存」「另存为」「新建节点」「撤销」「重做」「复制代码」。
- 手势：
  - **选中边**时，两端出现蓝色圆点（要新写，view.ts 里没有）。拖动圆点时，鼠标下面的节点高亮；松在节点上就 dispatch `retargetEdge`，松在空白处就取消，箭头弹回原位。
  - **鼠标悬停在节点上**时，四边出现连接点。现在 view.ts 第 828–961 行只有 connect 工具或按住 Alt 时才能拖线，要改成从连接点直接拖。拖到节点上就 connect；松在空白处弹出菜单，菜单里有「新建节点」和箭头样式 `-->` / `-.->` / `==>`（默认 `-->`），对应 connect 的 `line` 参数。
  - **双击文字**（第 778 行 onSvgDblClick，第 973 行 editEntityLabel）：Enter 确认，Esc 取消；双击没有文字的边，就是给它加文字。
  - Delete 键删除选中的东西（第 1383 行已经有了）；Ctrl+Z / Ctrl+Y 撤销和重做。
  - 拖动节点只改画布上的显示位置，不写进代码。
- 改过的行黄底高亮，2 秒后淡出（根据 change 事件里的 edits 算出行号）。
- 不是 flowchart 的图调用 `setReadOnly(true)`，顶部显示「只读预览」（用例 18）。core 本身支持编辑 sequence 等图，但产品规定 0.1 只读。
- SVG 里保留 mermaid 原来的节点 id 和边 id，不要改掉（correlate.ts 第 29 行就是靠这些 id 对应的）。
- 界面上的文字全部改成中文：view.ts 的弹出菜单（第 1467 行起）里有 `'Delete'` 等英文，都要换掉。core 返回的 warnings 用一条提示条显示。
- 打开和保存 `.mmd` / `.md`：保存 `.md` 时只替换第一个 ```` ```mermaid ```` 代码块的内容，文件里其他字节都不动。

### 6.2 Go 外壳（新建 `cmd/mermaid-editor`，`go.mod` 放在仓库根目录）
从 `D:\Projects\gitdash`（研发那边是 /workspace/gitdash）复制：
- `third_party/go-webview2` 整个目录，go.mod 里加 `replace github.com/jchv/go-webview2 => ./third_party/go-webview2`（gitdash 的 go.mod 第 11 行）。它的 `Run()` 循环已经处理了 WM_QUIT、主窗口关闭后退出，以及嵌套循环把退出消息转发出去（webview.go 第 513–546 行、第 84–86 行 `OnMainClose`）。
- `internal/applog`，要求按 1MB 轮转。
- `instance_windows.go` 里的单实例互斥锁（第 87–132 行）和 WebView2 数据目录的选择（第 139–147 行）。
- `win32_windows.go` 里的 `setClipboard`（第 41 行）和 `showFatal`（第 34 行）。
- `main_windows.go` 的 main 函数结构（第 223–258 行，第 330–336 行：`SetHtml`、`Run`、`exitNow`）和派发队列的看门狗（第 55–72 行）。

要求：
- `version = "0.1.0"`，窗口标题是 `Mermaid 编辑器 0.1.0`。
- 数据目录 `%LOCALAPPDATA%\mermaid-editor`，WebView2 数据放在 `%LOCALAPPDATA%\mermaid-editor\WebView2`，不和 gitdash 共用；日志写到 `%LOCALAPPDATA%\mermaid-editor\mermaid-editor.log`，启动第一件事就打开日志。
- 用 `//go:embed` 嵌入 `apps/mermaid-editor/dist/index.html`，构建前要把它复制到 `cmd/mermaid-editor/index.html`。
- 绑定这几个函数：`meOpen() {path,text}`（用 GetOpenFileNameW，过滤器「Mermaid 文件 (*.mmd;*.md)」），`meSave(path,text)`（原样写入字节，不改换行符），`meSaveAs(text) path`（GetSaveFileNameW），`meCopy(text)`，`meLog(msg)`。
- 文件对话框只能在派发回调里打开，不能在 binding 的调用栈上直接开嵌套循环（参见 webview.go 第 125 行的注释）。
- 关掉主窗口后，进程必须在 2 秒内退出。
- 没有 WebView2 运行时的时候，弹出中文提示（参照 gitdash 的写法）。

### 6.3 构建（PowerShell）
```powershell
cd D:\Projects\mermaid-editor
pnpm --filter mermaid-editor build
Copy-Item apps\mermaid-editor\dist\index.html cmd\mermaid-editor\index.html -Force
$env:GOTOOLCHAIN='go1.24.4'; $env:CGO_ENABLED='0'; $env:GOOS='windows'; $env:GOARCH='amd64'
go build -trimpath -ldflags "-s -w -H windowsgui" -o dist\mermaid-editor.exe .\cmd\mermaid-editor
Remove-Item Env:GOOS, Env:GOARCH
go vet ./... ; go test ./...
(Get-Item dist\mermaid-editor.exe).Length / 1MB    # 应在几 MB 以内
```
也可以在研发电脑上交叉编译出同样的 exe，再传过去（产品的建议）。

### 6.4 codex 提示词
> 按照 CODEX_TASKS.md 第 6.1 和 6.2 节新建 apps/mermaid-editor 和 cmd/mermaid-editor。界面文字一律用中文，所有工具栏按钮都要有 aria-label，代码框的 aria-label 是「代码」。不能用任何 CDN 或在线资源。Go 部分照搬 gitdash 的写法，不要自己另写消息循环。做完以后按 6.3 节构建，并贴出 exe 大小和 `pnpm -r run test` 的结果。

### 6.5 验收
- 断网时双击 exe 能打开，打开 01 样例可以完成三个手势。
- 关掉窗口后，任务管理器里没有残留的 mermaid-editor.exe。
- 日志和 WebView2 目录都在上面规定的路径。
- 测试能通过无障碍接口按名字找到所有按钮和代码框。
- 18（只读）和 19（10-large 上拖动不卡）由测试在 XiaoTN-Home 上测界面验收。
- 最后跑一遍 `npx tsx tools\cases\run-cases.mts`，27 条全部通过，或者明确标出哪些只能在界面上验。

### 6.6 README 和许可证
- `LICENSE` 保持原样（MIT, Copyright Inkeep）。
- README 开头加一段：「本项目 fork 自 [inkeep/mermaid-wysiwyg](https://github.com/inkeep/mermaid-wysiwyg)（MIT），核心解析和撤销机制来自原项目；中文 ID、改边端点、linkStyle 重算、Windows 外壳等为本项目新增。」
- 把 `dist/mermaid-editor.exe` 一起提交（和 gitdash 的做法一样），然后 `git push github master`。

---

## 27 条用例和步骤的对应关系

| 用例 | 在哪一步完成 | 备注 |
|---|---|---|
| 1, 21 | 5 | 补形状定义行 |
| 2, 3, 5 | 1 | 打完补丁就能过 |
| 4 | 5 | |
| 6 | 1（核心）/ 6（拖线手势） | ⚠ 要在渲染结果里确认 `DB --> UI` 写在「后端」子图里面时，不会把 UI 拉进这个子图；如果会，就改成写在最外层子图的 `end` 后面 |
| 7 | 1 | |
| 8 | 5 | 只提示不删 |
| 9 | 2 | |
| 10 | 4 | |
| 11, 12 | 5 | |
| 13 | 2E + 3 | 跨行 markdown 文字 |
| 14, 15 | 2 + 5 | |
| 16 | 3 | |
| 17 | 2A | CRLF |
| 18 | 1（核心）/ 6（界面只读） | |
| 19 | 1（核心）/ 6（性能，测试在界面上测） | |
| 20 | 1 | |
| 22, 23 | 5 | 22 的措辞冲突见第 5 步 |
| 24, 25, 26 | 4 | |
| 27 | 4 + 5 | |
