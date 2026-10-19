import { describe, expect, it } from 'vitest'
import { assertAllowedChanges, lineDiff, rawLines } from '../../../tools/cases/line-diff.mjs'

describe('用例运行器的字节级行差异检查', () => {
  it('保留 CRLF、空白行、tab、空格和末尾无换行', () => {
    expect(rawLines('\t甲  \r\n\r\n乙')).toEqual(['\t甲  \r\n', '\r\n', '乙'])
    expect(rawLines('')).toEqual([])
  })

  it('重复行使用 LCS 对齐，插入不误报后续各行', () => {
    expect(lineDiff('甲\n甲\n乙\n', '甲\n新\n甲\n乙\n')).toEqual([
      { kind: 'add', line: 2, text: '新\n' },
    ])
    expect(() => assertAllowedChanges('甲\n甲\n乙\n', '甲\n新\n甲\n乙\n', [
      { line: 2, remove: 0, add: ['新'] },
    ])).not.toThrow()
  })

  it('允许指定行删除和文件末尾新增', () => {
    expect(() => assertAllowedChanges('甲\n乙\n丙\n', '甲\n丙\n新\n', [
      { line: 2, remove: 1, add: [] }, { line: 4, remove: 0, add: ['新'] },
    ])).not.toThrow()
  })

  it.each([
    ['甲\r\n新\r\n', '改成 LF'],
    ['\t甲\r\n新\r\n', '丢失行尾空格'],
    ['  甲  \r\n新\r\n', '改动 tab'],
    ['\t甲  \r\n新\n', '新增行混用换行符'],
    ['\t甲  \r\n新', '丢失末尾换行'],
    ['\t甲  \r\n错\r\n', '新行内容不符合预期'],
    ['\t甲  \r\n乙\r\n新\r\n', '没有发生预期的替换'],
  ])('拒绝越界修改：%s（%s）', (after) => {
    expect(() => assertAllowedChanges('\t甲  \r\n乙\r\n', after, [
      { line: 2, remove: 1, add: ['新'] },
    ])).toThrow('行级改动不符合预期')
  })

  it('拒绝越界的允许行号', () => {
    expect(() => assertAllowedChanges('甲\n', '甲\n', [
      { line: 3, remove: 0, add: [] },
    ])).toThrow('允许改动的行号重叠或越界')
  })
})
