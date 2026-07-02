// ===== JsonEditor 组件，基于 CodeMirror 6 实现 JSON 编辑、语法高亮、格式化与错误校验 =====

import { useCallback, useEffect, useRef, type FC } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { lintGutter, linter } from "@codemirror/lint";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** JsonEditor 属性 */
interface JsonEditorProps {
  /** JSON 字符串内容 */
  value: string;
  /** 内容变化回调 */
  onChange: (value: string) => void;
  /** "dark" | "light"，控制 CodeMirror 主题 */
  theme?: string;
}

// ===== 浅色主题：高对比度编辑器样式和语法高亮 =====
/** 浅色主题下编辑器面板样式（背景、文字、选中、光标、行号等） */
const lightEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#ffffff",
      color: "#1a1a2e",
    },
    ".cm-content": {
      color: "#1a1a2e",
      caretColor: "#1a1a2e",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "#add6ff",
    },
    ".cm-activeLine": {
      backgroundColor: "#f0f1f3",
    },
    ".cm-gutters": {
      backgroundColor: "#f4f5f7",
      color: "#4b5563",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#e5e7eb",
    },
    ".cm-matchingBracket": {
      backgroundColor: "#d3e3fd",
      outline: "1px solid #87b9f9",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#f0f0f0",
      border: "1px solid #d0d0d0",
      color: "#6b7280",
    },
  },
  { dark: false },
);

/** 浅色主题下 JSON 语法元素颜色（属性名、字符串、数字、关键字等） */
const lightHighlightStyleExt = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.propertyName, color: "#881391" },   // JSON 属性名（紫色）
    { tag: tags.string, color: "#0451a5" },          // 字符串值（深蓝）
    { tag: tags.number, color: "#098658" },          // 数字（深绿）
    { tag: tags.bool, color: "#a31515" },            // true/false（深红）
    { tag: tags.null, color: "#a31515" },             // null（深红）
    { tag: tags.keyword, color: "#a31515" },          // 关键字（深红）
    { tag: tags.separator, color: "#1a1a2e" },        // 逗号分隔符
    { tag: tags.bracket, color: "#1a1a2e" },          // 括号
    { tag: tags.punctuation, color: "#1a1a2e" },      // 标点符号
  ]),
);

/** 浅色主题完整扩展（面板样式 + 语法高亮） */
const lightThemeExt = [lightEditorTheme, lightHighlightStyleExt];

/**
 * JsonEditor 组件
 *
 * 基于 CodeMirror 6 的 JSON 专用编辑器，提供：
 * - JSON 语法高亮
 * - 代码折叠/括号匹配（来自 basicSetup）
 * - 实时错误校验（红色波浪线 + 行号标记）
 * - 格式化按钮（一键美化 JSON）
 * - 暗色/浅色主题自动适配
 */
const JsonEditor: FC<JsonEditorProps> = ({ value, onChange, theme }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const isDark = theme === "dark";
  const themeCompartmentRef = useRef(new Compartment());
  const styleCompartmentRef = useRef(new Compartment());
  const initDoneRef = useRef(false);

  // 保持 onChange 引用最新，避免闭包陈旧
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 初始化 CodeMirror 实例（仅执行一次）
  useEffect(() => {
    if (!editorRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    // 自定义样式主题
    const customTheme = EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: "13px",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily:
            '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace',
        },
        ".cm-content": {
          padding: "8px 4px",
        },
        ".cm-gutters": {
          borderRight: isDark ? "1px solid #2d2d2d" : "1px solid #e5e7eb",
        },
      },
      { dark: isDark },
    );

    const state = EditorState.create({
      doc: value,
      extensions: [
        // 基础功能：行号、折叠、括号匹配、撤销/重做等
        basicSetup,
        // JSON 语言支持：语法高亮、代码折叠
        json(),
        // 实时 JSON 语法错误校验
        linter(jsonParseLinter(), { needsRefresh: () => true }),
        // 行号区域显示错误标记
        lintGutter(),
        // Tab 键缩进支持
        keymap.of([indentWithTab]),
        // 暗色/浅色主题（通过 Compartment 支持运行时切换）
        themeCompartmentRef.current.of(isDark ? oneDark : lightThemeExt),
        // 自定义样式（通过 Compartment 支持运行时切换）
        styleCompartmentRef.current.of(customTheme),
        // 更新监听
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });
    viewRef.current = view;
    initDoneRef.current = true;

    return () => {
      view.destroy();
      viewRef.current = null;
      initDoneRef.current = false;
    };
    // 仅在挂载/卸载时执行一次；主题通过 compartment 动态切换
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题切换：通过 Compartment 动态更新，避免销毁重建
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !initDoneRef.current) return;

    const customTheme = EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: "13px",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily:
            '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace',
        },
        ".cm-content": {
          padding: "8px 4px",
        },
        ".cm-gutters": {
          borderRight: isDark ? "1px solid #2d2d2d" : "1px solid #e5e7eb",
        },
      },
      { dark: isDark },
    );

    view.dispatch({
      effects: [
        themeCompartmentRef.current.reconfigure(isDark ? oneDark : lightThemeExt),
        styleCompartmentRef.current.reconfigure(customTheme),
      ],
    });
  }, [isDark]);

  // 外部 value 变化时同步到编辑器（如从集合加载请求）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // 格式化 JSON
  const handleFormat = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      view.dispatch({
        changes: { from: 0, to: text.length, insert: formatted },
      });
    } catch {
      // JSON 无效时不作任何更改
    }
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      {/* 工具栏 */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleFormat}
          className="btn-ghost text-xs px-2 py-0.5 rounded"
          title="格式化 JSON（美化排版）"
        >
          <svg
            className="w-3.5 h-3.5 inline-block mr-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 10h16M4 14h16M4 18h16"
            />
          </svg>
          Format
        </button>
      </div>
      {/* CodeMirror 容器 */}
      <div
        ref={editorRef}
        className={`border border-pulse-border rounded-lg overflow-hidden transition-colors ${
          isDark ? "" : "bg-white"
        }`}
        style={{ height: "100%" }}
      />
    </div>
  );
};

export default JsonEditor;
