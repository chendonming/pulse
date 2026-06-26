// ===== 快捷键核心引擎 =====
//
// 负责命令注册、全局 keydown 监听、作用域管理、和弦检测、冲突检测、序列化

import type { CommandDef, KeyCombo, ShortcutDef, ShortcutScope, ConflictResult, BindingDisplay, ChordState } from "./types";
import { serializeCombo } from "./defaults";

/** 序列化 KeyCombo 为存储格式 "ctrl+enter" */
function serializeKey(kc: KeyCombo): string {
  const parts: string[] = [];
  if (kc.ctrl) parts.push("ctrl");
  if (kc.meta) parts.push("meta");
  if (kc.alt) parts.push("alt");
  if (kc.shift) parts.push("shift");
  parts.push(kc.key.toLowerCase());
  return parts.join("+");
}

/** 从存储格式反序列化 */
function deserializeKey(str: string): KeyCombo {
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

/** 序列化 ShortcutDef（单键或和弦） */
function serializeDef(def: ShortcutDef): string {
  return Array.isArray(def) ? `${serializeKey(def[0])} ${serializeKey(def[1])}` : serializeKey(def);
}

/** 反序列化 ShortcutDef */
function deserializeDef(str: string): ShortcutDef {
  const parts = str.split(" ");
  if (parts.length === 2) return [deserializeKey(parts[0]), deserializeKey(parts[1])];
  return deserializeKey(str);
}

/** 比较两个 KeyCombo 是否相等 */
function combosMatch(a: KeyCombo, b: KeyCombo): boolean {
  return a.key.toLowerCase() === b.key.toLowerCase() && a.ctrl === b.ctrl && a.meta === b.meta && a.alt === b.alt && a.shift === b.shift;
}

/** 将 KeyboardEvent 转为 KeyCombo（排除仅修饰键事件） */
function eventToCombo(e: KeyboardEvent): KeyCombo | null {
  // 修饰键本身不触发快捷键匹配
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  return { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey };
}



export class ShortcutEngine {
  private commands = new Map<string, CommandDef>();
  private userBindings = new Map<string, ShortcutDef[]>();
  private bindingIndex = new Map<string, string[]>();
  private scopeStack: ShortcutScope[] = ["global"];
  private chordState: { first: KeyCombo; timeoutId: ReturnType<typeof setTimeout> } | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private listening = false;
  private chordListeners = new Set<(state: ChordState) => void>();

  readonly chordTimeout = 1000;

  // ── 公共 API ──

  /** 注册一个命令，可选择覆盖默认快捷键 */
  registerCommand(def: CommandDef, overrides?: ShortcutDef[]): void {
    this.commands.set(def.id, def);
    this.userBindings.set(def.id, overrides ?? []);
    this.rebuildBindingIndex();
  }

  /** 批量注册 DEFAULT_COMMANDS */
  registerDefaults(commands: CommandDef[]): void {
    for (const cmd of commands) {
      this.commands.set(cmd.id, cmd);
      if (!this.userBindings.has(cmd.id)) {
        this.userBindings.set(cmd.id, []);
      }
    }
    this.rebuildBindingIndex();
  }

  /** 获取命令有效快捷键（用户覆盖优先，其次默认） */
  getEffectiveBindings(commandId: string): ShortcutDef[] {
    const user = this.userBindings.get(commandId);
    if (user && user.length > 0) return user;
    const cmd = this.commands.get(commandId);
    return cmd?.defaultKeys ?? [];
  }

  /** 更新命令的快捷键绑定。返回冲突详情。 */
  updateBinding(commandId: string, newDefs: ShortcutDef[]): ConflictResult {
    // 检查每个新定义是否有冲突
    const conflicts: ConflictResult["conflictingCommands"] = [];
    for (const def of newDefs) {
      const serialized = serializeDef(def);
      const existing = this.bindingIndex.get(serialized) ?? [];
      for (const existingCmdId of existing) {
        if (existingCmdId === commandId) continue;
        const existingCmd = this.commands.get(existingCmdId);
        if (existingCmd) {
          conflicts.push({
            commandId: existingCmdId,
            label: existingCmd.label,
            shortcut: serialized,
          });
        }
      }
    }

    // 移除旧绑定的反向索引
    this.userBindings.set(commandId, newDefs);
    this.rebuildBindingIndex();

    return {
      hasConflict: conflicts.length > 0,
      conflictingCommands: conflicts,
    };
  }

  /** 移除命令的所有自定义绑定（恢复默认） */
  resetBinding(commandId: string): void {
    this.userBindings.delete(commandId);
    this.rebuildBindingIndex();
  }

  /** 重置所有绑定为默认 */
  resetAllBindings(): void {
    this.userBindings.clear();
    this.rebuildBindingIndex();
  }

  /** 开始监听 window keydown */
  start(): void {
    if (this.listening) return;
    this.keyHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
    window.addEventListener("keydown", this.keyHandler);
    this.listening = true;
  }

  /** 停止监听 */
  stop(): void {
    if (!this.listening || !this.keyHandler) return;
    window.removeEventListener("keydown", this.keyHandler);
    this.keyHandler = null;
    this.listening = false;
  }

  /** 推入作用域 */
  pushScope(scope: ShortcutScope): void {
    this.scopeStack.push(scope);
  }

  /** 弹出作用域（移除最后一次出现） */
  popScope(scope: ShortcutScope): void {
    const idx = this.scopeStack.lastIndexOf(scope);
    if (idx >= 0) this.scopeStack.splice(idx, 1);
    // 确保始终有 global
    if (this.scopeStack.length === 0) this.scopeStack.push("global");
  }

  /** 检测快捷键是否与现有命令冲突 */
  detectConflicts(def: ShortcutDef, excludeCommandId?: string): ConflictResult {
    const serialized = serializeDef(def);
    const existing = this.bindingIndex.get(serialized) ?? [];
    const conflicts = existing
      .filter((id) => id !== excludeCommandId)
      .map((id) => {
        const cmd = this.commands.get(id);
        return cmd ? { commandId: id, label: cmd.label, shortcut: serialized } : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    return { hasConflict: conflicts.length > 0, conflictingCommands: conflicts };
  }

  /** 获取序列化绑定用于持久化 */
  getSerializedBindings(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [id, defs] of this.userBindings) {
      if (defs.length > 0) {
        result[id] = defs.map(serializeDef);
      }
    }
    return result;
  }

  /** 从持久化数据加载绑定 */
  loadSerializedBindings(data: Record<string, string[]>): void {
    for (const [id, serializedDefs] of Object.entries(data)) {
      if (this.commands.has(id)) {
        this.userBindings.set(id, serializedDefs.map(deserializeDef));
      }
    }
    this.rebuildBindingIndex();
  }

  /** 获取所有命令的展示数据 */
  getAllBindings(): BindingDisplay[] {
    return Array.from(this.commands.values()).map((cmd) => ({
      commandId: cmd.id,
      label: cmd.label,
      category: cmd.category,
      defs: this.getEffectiveBindings(cmd.id),
      scope: cmd.scope,
    }));
  }

  /** 获取和弦等待状态 */
  getChordState(): ChordState | null {
    if (!this.chordState) return null;
    return { active: true, prefix: serializeCombo(this.chordState.first) };
  }

  /** 和弦状态变化监听 */
  onChordChange(listener: (state: ChordState | null) => void): () => void {
    const wrapped = (s: ChordState) => listener(s);
    this.chordListeners.add(wrapped);
    return () => this.chordListeners.delete(wrapped);
  }

  // ── 内部方法 ──

  private rebuildBindingIndex(): void {
    this.bindingIndex.clear();

    for (const cmd of this.commands.values()) {
      const defs = this.getEffectiveBindings(cmd.id);
      for (const def of defs) {
        const serialized = serializeDef(def);
        const list = this.bindingIndex.get(serialized) ?? [];
        if (!list.includes(cmd.id)) {
          list.push(cmd.id);
          this.bindingIndex.set(serialized, list);
        }
      }
    }
  }

  /** 获取当前活跃作用域 */
  private getActiveScope(): ShortcutScope {
    // dialog 具有最高优先级，阻止所有其他作用域
    if (this.scopeStack.includes("dialog")) return "dialog";

    // 从栈顶向下查找第一个非 global 作用域
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      if (this.scopeStack[i] !== "global") return this.scopeStack[i];
    }
    return "global";
  }

  /** 检查 combo 是否是某个和弦的第一个按键 */
  private isChordPrefix(combo: KeyCombo): boolean {
    for (const cmd of this.commands.values()) {
      const defs = this.getEffectiveBindings(cmd.id);
      for (const def of defs) {
        if (Array.isArray(def) && combosMatch(def[0], combo)) return true;
      }
    }
    return false;
  }

  /** 查找匹配当前作用域和按键的命令 */
  private findMatchingCommand(combo: KeyCombo, scope: ShortcutScope): CommandDef | null {
    for (const cmd of this.commands.values()) {
      const defs = this.getEffectiveBindings(cmd.id);
      for (const def of defs) {
        const singleCombo = Array.isArray(def) ? def[1] : def;
        if (!combosMatch(singleCombo, combo)) continue;
        // 作用域匹配：dialog 作用域只匹配 dialog 命令
        if (scope === "dialog") {
          if (cmd.scope === "dialog") return cmd;
          continue;
        }
        // 非 dialog 作用域：匹配当前作用域或 global 命令
        if (cmd.scope === scope || cmd.scope === "global") return cmd;
      }
    }
    return null;
  }


  private handleKeyDown(e: KeyboardEvent): void {
    const combo = eventToCombo(e);
    if (!combo) return;

    // 步骤 1: 和弦等待中 — 检查是否匹配和弦第二步
    if (this.chordState) {
      clearTimeout(this.chordState.timeoutId);
      const first = this.chordState.first;
      this.chordState = null;
      this.notifyChordListeners();

      for (const cmd of this.commands.values()) {
        const defs = this.getEffectiveBindings(cmd.id);
        for (const def of defs) {
          if (!Array.isArray(def)) continue;
          if (combosMatch(def[0], first) && combosMatch(def[1], combo)) {
            const scope = this.getActiveScope();
            if (scope === "dialog" && cmd.scope !== "dialog") continue;
            if (scope !== "dialog" && cmd.scope !== scope && cmd.scope !== "global") continue;
            e.preventDefault();
            cmd.handler();
            return;
          }
        }
      }
      // 和弦不匹配 — 让事件正常传播
      return;
    }

    // 步骤 2: 检查是否是和弦前缀
    if (this.isChordPrefix(combo)) {
      e.preventDefault();
      this.chordState = {
        first: combo,
        timeoutId: setTimeout(() => {
          this.chordState = null;
          this.notifyChordListeners();
        }, this.chordTimeout),
      };
      this.notifyChordListeners();
      return;
    }

    // 步骤 3: 检查普通快捷键匹配
    const matched = this.findMatchingCommand(combo, this.getActiveScope());
    if (matched) {
      e.preventDefault();
      matched.handler();
    }
  }

  private notifyChordListeners(): void {
    const state = this.getChordState();
    for (const listener of this.chordListeners) {
      listener(state!);
    }
  }
}
