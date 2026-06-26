// ===== 快捷键管理系统类型定义 =====

/** 键组合（单个快捷键） */
export interface KeyCombo {
  key: string; // KeyboardEvent.key 值，如 "Enter", "s", "1", "Escape"
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

/** 快捷键定义：单键或两步和弦 */
export type ShortcutDef = KeyCombo | [KeyCombo, KeyCombo];

/**
 * 作用域（优先级数字越大越高）
 * dialog 可见时阻止所有非 dialog 快捷键
 */
export type ShortcutScope =
  | "global" // 始终活跃
  | "sidebar"
  | "requestPanel"
  | "responsePanel"
  | "dialog"; // 模态对话框打开时

/** 命令定义（注册时使用） */
export interface CommandDef {
  id: string; // 唯一命令 ID，如 "sendRequest"
  label: string; // 人类可读名称："Send Request"
  category: string; // 编辑器 UI 分组："Request Operations"
  defaultKeys: ShortcutDef[]; // 每个命令可有多个绑定（单键或和弦）
  scope: ShortcutScope;
  handler: () => void;
}

/** 持久化格式 */
export interface KeybindingData {
  bindings: Record<string, string[]>; // commandId -> 序列化快捷键数组
  version: number; // 用于未来迁移
}

/** 冲突检查结果 */
export interface ConflictResult {
  hasConflict: boolean;
  conflictingCommands: Array<{
    commandId: string;
    label: string;
    shortcut: string;
  }>;
}

/** 用于渲染的展示数据 */
export interface BindingDisplay {
  commandId: string;
  label: string;
  category: string;
  defs: ShortcutDef[];
  scope: ShortcutScope;
}

/** 和弦等待状态 */
export interface ChordState {
  active: boolean;
  prefix: string; // 显示文本，如 "Ctrl+K"
}
