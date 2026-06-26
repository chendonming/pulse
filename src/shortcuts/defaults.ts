// ===== 默认快捷键注册表 =====

import type { CommandDef, KeyCombo } from "./types";

/**
 * 从字符串解析 KeyCombo
 * 格式: "ctrl+shift+enter", "meta+s", "escape", "ctrl+k"
 */
export function combo(str: string): KeyCombo {
  const parts = str.toLowerCase().split("+");
  const key = parts.pop()!;
  return {
    key: key === "enter" ? "Enter" : key === "escape" ? "Escape" : key,
    ctrl: parts.includes("ctrl"),
    meta: parts.includes("meta"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
  };
}

/**
 * 序列化 KeyCombo 为可读字符串
 */
export function serializeCombo(kc: KeyCombo): string {
  const parts: string[] = [];
  if (kc.ctrl) parts.push("Ctrl");
  if (kc.meta) parts.push("Meta");
  if (kc.alt) parts.push("Alt");
  if (kc.shift) parts.push("Shift");
  parts.push(kc.key === " " ? "Space" : kc.key);
  return parts.join("+");
}

/** 所有默认命令（handler 在 App.tsx 注册时填充） */
export const DEFAULT_COMMANDS: CommandDef[] = [
  // ── Request Operations ──
  {
    id: "sendRequest",
    label: "Send Request",
    category: "Request Operations",
    defaultKeys: [combo("ctrl+enter"), combo("meta+enter")],
    scope: "global",
    handler: () => {},
  },
  {
    id: "newRequest",
    label: "New Request",
    category: "Request Operations",
    defaultKeys: [combo("ctrl+n"), combo("meta+n")],
    scope: "global",
    handler: () => {},
  },
  {
    id: "saveRequest",
    label: "Save Request",
    category: "Request Operations",
    defaultKeys: [combo("ctrl+s"), combo("meta+s")],
    scope: "global",
    handler: () => {},
  },
  {
    id: "focusUrlBar",
    label: "Focus URL Bar",
    category: "Request Operations",
    defaultKeys: [combo("ctrl+l"), combo("meta+l")],
    scope: "global",
    handler: () => {},
  },
  {
    id: "clearResponse",
    label: "Clear Response",
    category: "Request Operations",
    defaultKeys: [combo("ctrl+shift+c"), combo("meta+shift+c")],
    scope: "global",
    handler: () => {},
  },
  // ── Navigation ──
  {
    id: "switchCollectionsTab",
    label: "Show Collections",
    category: "Navigation",
    defaultKeys: [combo("ctrl+1"), combo("meta+1")],
    scope: "global",
    handler: () => {},
  },
  {
    id: "switchHistoryTab",
    label: "Show History",
    category: "Navigation",
    defaultKeys: [combo("ctrl+2"), combo("meta+2")],
    scope: "global",
    handler: () => {},
  },
  {
    id: "switchEnvironmentsTab",
    label: "Show Environments",
    category: "Navigation",
    defaultKeys: [combo("ctrl+3"), combo("meta+3")],
    scope: "global",
    handler: () => {},
  },
  {
    id: "requestTabParams",
    label: "Request Tab: Params",
    category: "Navigation",
    defaultKeys: [combo("ctrl+shift+1"), combo("meta+shift+1")],
    scope: "requestPanel",
    handler: () => {},
  },
  {
    id: "requestTabAuth",
    label: "Request Tab: Auth",
    category: "Navigation",
    defaultKeys: [combo("ctrl+shift+2"), combo("meta+shift+2")],
    scope: "requestPanel",
    handler: () => {},
  },
  {
    id: "requestTabHeaders",
    label: "Request Tab: Headers",
    category: "Navigation",
    defaultKeys: [combo("ctrl+shift+3"), combo("meta+shift+3")],
    scope: "requestPanel",
    handler: () => {},
  },
  {
    id: "requestTabBody",
    label: "Request Tab: Body",
    category: "Navigation",
    defaultKeys: [combo("ctrl+shift+4"), combo("meta+shift+4")],
    scope: "requestPanel",
    handler: () => {},
  },
  {
    id: "responseTabBody",
    label: "Response Tab: Body",
    category: "Navigation",
    defaultKeys: [combo("ctrl+shift+5"), combo("meta+shift+5")],
    scope: "responsePanel",
    handler: () => {},
  },
  {
    id: "responseTabHeaders",
    label: "Response Tab: Headers",
    category: "Navigation",
    defaultKeys: [combo("ctrl+shift+6"), combo("meta+shift+6")],
    scope: "responsePanel",
    handler: () => {},
  },
  // ── Dialog ──
  {
    id: "dialogConfirm",
    label: "Confirm Dialog",
    category: "Dialog",
    defaultKeys: [combo("enter")],
    scope: "dialog",
    handler: () => {},
  },
  {
    id: "dialogCancel",
    label: "Cancel Dialog",
    category: "Dialog",
    defaultKeys: [combo("escape")],
    scope: "dialog",
    handler: () => {},
  },
  // ── Preferences ──
  {
    id: "openKeybindingsEditor",
    label: "Open Keyboard Shortcuts",
    category: "Preferences",
    defaultKeys: [[combo("ctrl+k"), combo("ctrl+s")], [combo("meta+k"), combo("meta+s")]],
    scope: "global",
    handler: () => {},
  },
];
