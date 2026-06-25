// ===== JSON 语法高亮组件 =====
// 使用自定义正则 tokenizer 对 JSON 响应体进行着色
// 不依赖任何外部语法高亮库

import { useMemo } from "react";

/** 标记类型 */
type TokenType =
  | "key" // JSON 键名
  | "string" // JSON 字符串值
  | "number" // 数字
  | "keyword" // true / false / null
  | "structural" // { } [ ]
  | "punctuation" // , :
  | "whitespace"; // 空白（不染色）

/** 标记化结果 */
interface Token {
  text: string;
  type: TokenType;
}

/**
 * Token 颜色映射 —— 使用 pulse 主题色
 * whitespace 直接返回文本，不生成 span
 */
const TOKEN_CLASS: Record<TokenType, string | null> = {
  key: "text-pulse-blue",
  string: "text-pulse-emerald",
  number: "text-pulse-amber",
  keyword: "text-pulse-purple",
  structural: "text-pulse-text-primary",
  punctuation: "text-pulse-text-muted",
  whitespace: null,
};

/**
 * 单遍正则扫描 JSON，产出 Token[]
 *
 * 匹配顺序（优先级从高到低）：
 *  1. Key 字符串 —— "..." 后跟冒号（用 lookahead 判断）
 *  2. Value 字符串 —— 普通带引号的值
 *  3. 关键字 —— true / false / null
 *  4. 数字 —— 整数 / 小数 / 科学计数法
 *  5. 结构字符 —— { } [ ]
 *  6. 分隔符 —— , :
 *  7. 空白 —— 保留原格式
 *  8. 其他 —— 兜底，确保无遗漏
 */
const TOKEN_RE =
  /("(?:[^"\\]|\\.)*")(?=\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]])|([,:])|(\s+)|(.+?)/g;

/** 对 JSON 文本执行标记化 */
function tokenizeJson(text: string): Token[] {
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;

  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1] !== undefined) {
      // group 1: key 字符串（后跟 :）
      tokens.push({ text: m[1], type: "key" });
    } else if (m[2] !== undefined) {
      // group 2: value 字符串
      tokens.push({ text: m[2], type: "string" });
    } else if (m[3] !== undefined) {
      // group 3: 关键字 true / false / null
      tokens.push({ text: m[3], type: "keyword" });
    } else if (m[4] !== undefined) {
      // group 4: 数字
      tokens.push({ text: m[4], type: "number" });
    } else if (m[5] !== undefined) {
      // group 5: 结构字符 { } [ ]
      tokens.push({ text: m[5], type: "structural" });
    } else if (m[6] !== undefined) {
      // group 6: 分隔符 , :
      tokens.push({ text: m[6], type: "punctuation" });
    } else if (m[7] !== undefined) {
      // group 7: 空白
      tokens.push({ text: m[7], type: "whitespace" });
    } else if (m[8] !== undefined) {
      // group 8: 兜底 —— 保持原样，不染色
      tokens.push({ text: m[8], type: "whitespace" });
    }
  }

  return tokens;
}

/** ===== JSON 语法高亮组件 =====
 *
 * 接收响应体和 Content-Type，自动判断是否需要高亮。
 * JSON 内容会先 pretty-print 再逐 token 着色；
 * 非 JSON 内容原样输出；空 body 显示占位文字。
 */
export default function JsonHighlighter({
  body,
  contentType,
}: {
  body: string;
  contentType?: string | null;
}) {
  const rendered = useMemo(() => {
    // 空 body
    if (!body) return null;

    // 非 JSON 内容：原样输出，不做高亮
    if (!contentType?.includes("json")) {
      return body;
    }

    // 尝试 pretty-print
    let formatted: string;
    try {
      formatted = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // JSON 解析失败：回退到原始文本
      return body;
    }

    // 标记化 + 着色
    const tokens = tokenizeJson(formatted);
    return tokens.map((t, i) => {
      const cls = TOKEN_CLASS[t.type];
      if (!cls) return t.text; // 空白 token 直接返回文本
      return (
        <span key={i} className={cls}>
          {t.text}
        </span>
      );
    });
  }, [body, contentType]);

  return rendered ?? (
    <span className="text-pulse-text-muted italic">Empty response body</span>
  );
}
