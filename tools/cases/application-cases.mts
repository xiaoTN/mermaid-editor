import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Run the real React application/CodeMirror suites once and attach the missing
 * numbered cases to their assertions. Real Windows coverage runs separately. */
export function createApplicationCases(root: string): [string, string, () => void][] {
  let application: any
  const suite = () => {
    if (!application) {
      const output = join(root, 'out/cases/application.json')
      const run = spawnSync(process.execPath, [join(root, 'packages/dom/node_modules/vitest/vitest.mjs'), 'run',
        'test/application.test.tsx', 'test/desktop-lifecycle.test.tsx', 'test/viewport.test.ts',
        '--reporter=json', `--outputFile=${output}`], { cwd: join(root, 'packages/dom'), encoding: 'utf8' })
      assert.equal(run.status, 0, run.stdout + run.stderr)
      application = JSON.parse(readFileSync(output, 'utf8'))
      assert.equal(application.success, true)
    }
    return application.testResults.flatMap((file: any) => file.assertionResults)
  }
  const covered = (pattern: RegExp) => () => {
    const tests = suite().filter((test: any) => pattern.test(test.fullName))
    assert(tests.length > 0, `missing application assertions: ${pattern}`)
    assert(tests.every((test: any) => test.status === 'passed'))
  }
  return [
    ['41', '真实 App：标题/星号及关闭的保存、不保存、取消；原生回车默认由 Go/Windows 验证', covered(/close .*cleans drafts/)],
    ['42', '真实 App：打开、原始字节保存及失败提示；系统筛选由 Go 测试验证', covered(/打开沿用文件名|打开保存失败/)],
    ['43', '真实 App：启动磁盘内容与草稿提示、丢弃、保存清理，路径哈希隔离', covered(/startup reads disk|桌面提示栏/)],
    ['44', '真实 App：原生拖入路径共用打开流程，带当前文件名的提示及取消', covered(/native drop\/open/)],
    ['45', '构建产物：单文件 PE、GUI 子系统、≤15 MiB', () => {
      const exe = readFileSync(join(root, 'dist/mermaid-editor.exe'))
      assert(exe.length <= 15 * 1024 * 1024)
      assert.equal(exe.toString('ascii', 0, 2), 'MZ')
      assert.equal(exe.readUInt16LE(exe.readUInt32LE(0x3c) + 24 + 68), 2)
    }],
    ['53', '真实 App：打开文件、编辑一处、点击保存；三步操作可自动化，主观可发现性仍需人工', covered(/打开沿用文件名|53:/)],
    ['54', '真实 App：关闭三种决定、保存失败时保持打开；按钮默认值另有原生测试', covered(/close .*cleans drafts/)],
    ['55', '原生打开事件：干净直接打开、脏文件只出现一次带文件名的打开提示；Explorer 手势需人工', covered(/native drop\/open|55:/)],
    ['56', '真实 App + CodeMirror：黄色持续，切换选中与重叠共存，保存清除', covered(/changed lines persist/)],
    ['E1', '真实 Louvre SVG：自动 fit 最小 60%，溢出可滚动，手动缩放不受限', covered(/E1:/)],
    ['E2', '非流程图全部预览：含时序图、甘特图、饼图及类成员，隐藏画布操作且禁止新增', covered(/E2:/)],
    ['6d', '外部修改聚焦/定时检测、三项保存兜底、草稿清理及平移后的首次点击', covered(/focus reloads|timer checks|first edge press/)],
  ]
}
