import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  SHORTCUTS,
  defaultShortcut,
  findConflict,
  formatShortcut,
  fromChord,
  normalizeSpec,
  parseShortcut,
  platformKind,
  resolveShortcuts,
  shortcutProblem,
  toAccelerator,
  type KeyChord,
  type ResolvedShortcuts,
  type ShortcutId
} from '../../src/core/shortcuts'

/** 只写关心的那几个修饰键，其余默认 false。 */
function chord(partial: Partial<KeyChord> & { code: string }): KeyChord {
  return { meta: false, ctrl: false, alt: false, shift: false, ...partial }
}

describe('platformKind', () => {
  it('只把 darwin 认成 darwin，其余一律 other', () => {
    expect(platformKind('darwin')).toBe('darwin')
    expect(platformKind('win32')).toBe('other')
    expect(platformKind('linux')).toBe('other')
    expect(platformKind('')).toBe('other')
  })
})

describe('fromChord', () => {
  it('按固定的修饰键顺序拼出来——同一个键的两种按法得到同一个串', () => {
    // 规范化是这一层唯一的职责：`findConflict` 与 `resolveShortcuts` 都拿它当比较基准，
    // 顺序不固定的话「Meta+Shift+KeyH」与「Shift+Meta+KeyH」会被当成两条不同的快捷键。
    expect(fromChord(chord({ code: 'KeyH', meta: true, shift: true }))).toBe('Meta+Shift+KeyH')
    expect(fromChord(chord({ code: 'KeyH', shift: true, meta: true }))).toBe('Meta+Shift+KeyH')
    expect(fromChord(chord({ code: 'KeyO', ctrl: true, alt: true }))).toBe('Ctrl+Alt+KeyO')
  })

  it('没有修饰键就不合法——这个应用每一次裸按键都要去抽字，录成快捷键等于把打字吃掉', () => {
    expect(fromChord(chord({ code: 'KeyO' }))).toBeNull()
  })

  it('白名单之外的键位不合法——accelerator 表达不了它们', () => {
    expect(fromChord(chord({ code: 'IntlBackslash', meta: true }))).toBeNull()
    expect(fromChord(chord({ code: 'NumpadAdd', meta: true }))).toBeNull()
  })

  it('白名单里的标点与功能键是合法的', () => {
    expect(fromChord(chord({ code: 'Comma', meta: true }))).toBe('Meta+Comma')
    expect(fromChord(chord({ code: 'F5', ctrl: true }))).toBe('Ctrl+F5')
    expect(fromChord(chord({ code: 'ArrowUp', alt: true }))).toBe('Alt+ArrowUp')
  })
})

describe('parseShortcut / normalizeSpec', () => {
  it('往返一致', () => {
    // 【判据必须是双向的】原来写的是 `if (parsed === null) continue`——那让解析器退回 null
    // 反而让用例更绿。实测：把 `Comma` 从白名单里删掉，这条用例仍然 exit 0
    // （1 passed | 30 skipped）。所以这里断言「必须解析得出来」，失败就是失败。
    for (const spec of ['Meta+KeyO', 'Ctrl+Shift+KeyH', 'Meta+Comma', 'Ctrl+Alt+KeyF']) {
      const parsed = parseShortcut(spec)
      expect(parsed, `${spec} 应当解析得出来`).not.toBeNull()
      expect(fromChord(parsed as KeyChord)).toBe(spec)
    }
  })

  it('把乱序写法归一化', () => {
    expect(normalizeSpec('Shift+Meta+KeyH')).toBe('Meta+Shift+KeyH')
  })

  it('解析不了的返回 null', () => {
    expect(normalizeSpec('KeyO')).toBeNull() // 裸键
    expect(normalizeSpec('Meta+Bogus')).toBeNull()
    expect(normalizeSpec('Meta+Meta+KeyO')).toBeNull() // 重复修饰键
    expect(normalizeSpec('')).toBeNull()
  })

  it('原型链上的名字不算白名单内——手改过的 settings.json 塞得进它们', () => {
    for (const code of ['toString', '__proto__', 'constructor', 'valueOf']) {
      expect(normalizeSpec(`Meta+${code}`), `Meta+${code} 不该被当成合法`).toBeNull()
      expect(fromChord(chord({ code, meta: true }))).toBeNull()
    }
  })
})

describe('shortcutProblem', () => {
  it('合法组合返回 null', () => {
    expect(shortcutProblem('Meta+KeyO', 'darwin')).toBeNull()
    expect(shortcutProblem('Ctrl+KeyO', 'other')).toBeNull()
  })

  it('裸键与不支持的键位要分开报——设置界面按理由给不同提示', () => {
    expect(shortcutProblem('KeyO', 'other')).toBe('no-modifier')
    expect(shortcutProblem('Meta+Bogus', 'other')).toBe('unsupported-key')
  })

  it('只在 macOS 上拦保留键', () => {
    // 这些是 menu.ts 里 role 正在用的键，抢过来会废掉退出 / 关闭窗口 / 复制粘贴
    expect(shortcutProblem('Meta+KeyQ', 'darwin')).toBe('reserved')
    expect(shortcutProblem('Meta+KeyQ', 'other')).toBeNull()
  })

  it('保留键的乱序写法也拦得住——比对的是归一化之后的值', () => {
    expect(shortcutProblem('Shift+Meta+KeyQ', 'darwin')).toBe('reserved')
  })

  it('保留清单里的每一条都真的被拦——这是一条策略，不是实现细节', () => {
    // 【为什么值得钉】实测：把其中八条从 RESERVED 里删掉，整个文件仍然 31 passed——
    // 它挡的是「录了 ⌘C 之后用户再也复制不了」这类事故，不能只靠 ⌘Q 一条当代表。
    for (const key of [
      'Meta+KeyQ', 'Meta+Shift+KeyQ', 'Meta+KeyW', 'Meta+KeyM', 'Meta+KeyH',
      'Meta+KeyC', 'Meta+KeyV', 'Meta+KeyX', 'Meta+KeyA', 'Meta+KeyZ'
    ]) {
      expect(shortcutProblem(key, 'darwin'), `${key} 应当是保留键`).toBe('reserved')
      // 同一条在别的平台不该被拦——否则它就不是「macOS 的」清单了
      expect(shortcutProblem(key, 'other')).toBeNull()
    }
  })
})

describe('resolveShortcuts', () => {
  it('缺条目落到该平台的默认值', () => {
    expect(resolveShortcuts({}, 'darwin').import).toBe('Meta+KeyO')
    expect(resolveShortcuts({}, 'other').import).toBe('Ctrl+KeyO')
    /**
     * 【老板键这三条必须**字面**钉住】它们此前只有「合法性 / 不冲突 / 能转 accelerator」
     * 那一类全域性质测试守着——那种测试对「把 `Meta+Shift+KeyB` 改成别的一个也合法的组合」
     * 完全沉默。而这三条是用户唯一能按到老板键的入口，改了没人会红。
     */
    for (const [platform, expected] of [
      ['darwin', ['Meta+Shift+KeyB', 'Meta+Shift+ArrowUp', 'Meta+Shift+ArrowDown']],
      ['other', ['Ctrl+Shift+KeyB', 'Ctrl+Shift+ArrowUp', 'Ctrl+Shift+ArrowDown']]
    ] as const) {
      const table = resolveShortcuts({}, platform)
      const ids = ['boss-key', 'boss-fill-up', 'boss-fill-down'] as const
      ids.forEach((id, i) => {
        expect(table[id], `${platform} 上 ${id} 的字面默认值`).toBe(expected[i])
      })
    }
  })

  it('给了的条目用给的', () => {
    expect(resolveShortcuts({ import: 'Ctrl+KeyI' }, 'other').import).toBe('Ctrl+KeyI')
  })

  it('坏值退回默认值，而不是把坏串放行', () => {
    expect(resolveShortcuts({ import: 'KeyO' }, 'other').import).toBe('Ctrl+KeyO')
    expect(resolveShortcuts({ import: 'Meta+Bogus' }, 'other').import).toBe('Ctrl+KeyO')
  })

  it('macOS 上磁盘里的保留键也退回默认值，不是只在录制端拦', () => {
    expect(resolveShortcuts({ import: 'Meta+KeyQ' }, 'darwin').import).toBe('Meta+KeyO')
  })

  it('乱序写法会被归一化', () => {
    expect(resolveShortcuts({ import: 'Shift+Ctrl+KeyI' }, 'other').import).toBe('Ctrl+Shift+KeyI')
  })

  it('返回的表覆盖注册表里的每一条', () => {
    const out = resolveShortcuts({}, 'other')
    for (const def of SHORTCUTS) expect(typeof out[def.id]).toBe('string')
  })

  it('解析结果的键集恰好等于表里的 id 集合——加一行表就自动多一项，没有第二份清单', () => {
    for (const kind of ['darwin', 'other'] as const) {
      const keys = Object.keys(resolveShortcuts({}, kind)).sort()
      expect(keys).toEqual(SHORTCUTS.map((def) => def.id).sort())
    }
  })
})

/**
 * 类型闸：`ShortcutId` 必须就是表里 id 的联合（真正的保证在 shortcuts.ts 的 `as const` 推导）。
 * 断言只在 tsconfig.test.json 做类型检查时生效；`vitest run` 本身不做类型检查。
 */
describe('ShortcutId 由 SHORTCUTS 推导', () => {
  it('type: ShortcutId 等于表里 id 的联合', () => {
    expectTypeOf<ShortcutId>().toEqualTypeOf<(typeof SHORTCUTS)[number]['id']>()
  })

  it('type: ResolvedShortcuts 的键恰好是 ShortcutId', () => {
    expectTypeOf<keyof ResolvedShortcuts>().toEqualTypeOf<ShortcutId>()
  })
})

describe('formatShortcut', () => {
  it('macOS 用符号，顺序按 Apple 惯例 ⌃⌥⇧⌘', () => {
    expect(formatShortcut('Meta+KeyO', 'darwin')).toBe('⌘O')
    expect(formatShortcut('Meta+Shift+KeyH', 'darwin')).toBe('⇧⌘H')
    expect(formatShortcut('Ctrl+KeyO', 'darwin')).toBe('⌃O')
  })

  it('其它平台用词', () => {
    expect(formatShortcut('Ctrl+KeyO', 'other')).toBe('Ctrl+O')
    expect(formatShortcut('Ctrl+Shift+KeyH', 'other')).toBe('Ctrl+Shift+H')
    expect(formatShortcut('Meta+KeyO', 'other')).toBe('Win+O')
    expect(formatShortcut('Ctrl+Comma', 'other')).toBe('Ctrl+,')
  })

  it('解析不了的串原样返回——宁可显示得怪，也不要显示成空', () => {
    expect(formatShortcut('Bogus', 'darwin')).toBe('Bogus')
  })
})

describe('toAccelerator', () => {
  it('Meta 在 accelerator 里叫 Cmd', () => {
    expect(toAccelerator('Meta+KeyO')).toBe('Cmd+O')
    expect(toAccelerator('Meta+Shift+KeyH')).toBe('Cmd+Shift+H')
    expect(toAccelerator('Ctrl+Comma')).toBe('Ctrl+,')
    expect(toAccelerator('Alt+F5')).toBe('Alt+F5')
  })

  it('白名单保证了它不会失败——这正是「谁执行」那张表能保持静态的前提', () => {
    for (const def of SHORTCUTS) {
      expect(toAccelerator(def.defaults.darwin)).not.toBeNull()
      expect(toAccelerator(def.defaults.other)).not.toBeNull()
    }
  })
})

describe('findConflict', () => {
  const table = resolveShortcuts({}, 'other')

  it('撞上另一条就返回它的 id', () => {
    expect(findConflict(table, 'Ctrl+Shift+KeyH', 'import')).toBe('toggle-sidebar')
  })

  it('和自己那条不算撞', () => {
    expect(findConflict(table, 'Ctrl+KeyO', 'import')).toBeNull()
  })

  it('不撞时返回 null', () => {
    expect(findConflict(table, 'Ctrl+KeyI', 'import')).toBeNull()
  })

  it('乱序写法也认得出来是同一个键', () => {
    expect(findConflict(table, 'Shift+Ctrl+KeyH', 'import')).toBe('toggle-sidebar')
  })
})

describe('注册表本身', () => {
  it('id 不重复', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('两条平台默认值各自合法', () => {
    for (const def of SHORTCUTS) {
      expect(shortcutProblem(def.defaults.darwin, 'darwin')).toBeNull()
      expect(shortcutProblem(def.defaults.other, 'other')).toBeNull()
    }
  })

  it('默认值之间互不冲突', () => {
    for (const kind of ['darwin', 'other'] as const) {
      const table = resolveShortcuts({}, kind)
      for (const def of SHORTCUTS) {
        expect(findConflict(table, table[def.id], def.id)).toBeNull()
      }
    }
  })

  it('defaultShortcut 取的是该平台的默认值', () => {
    expect(defaultShortcut('open-settings', 'darwin')).toBe('Meta+Comma')
    expect(defaultShortcut('open-settings', 'other')).toBe('Ctrl+Comma')
  })
})
