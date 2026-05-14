import type { Locale } from "@/shared/i18n";

export type AppFontId =
  | "maple-mono-cn"
  | "lxgw-wenkai"
  | "noto-sans-sc"
  | "source-han-sans"
  | "ibm-plex-noto"
  | "inter-noto"
  | "jetbrains-noto"
  | "system";

export interface AppFontOption {
  id: AppFontId;
  label: Record<Locale, string>;
  description: Record<Locale, string>;
  stack: string;
  probeFonts: string[];
}

const STORAGE_KEY = "pi-tauri.defaultFont";

export const appFontOptions: AppFontOption[] = [
  {
    id: "maple-mono-cn",
    label: { "zh-CN": "Maple Mono NF CN", en: "Maple Mono NF CN" },
    description: { "zh-CN": "默认推荐：代码感强，中文与英文统一。", en: "Default: code-friendly with consistent CJK/Latin rhythm." },
    stack: `"Maple Mono NF CN", "Maple Mono NF", "Maple Mono SC NF", "Maple Mono", "LXGW WenKai Mono", ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, monospace`,
    probeFonts: ["Maple Mono NF CN", "Maple Mono NF", "Maple Mono SC NF", "Maple Mono"],
  },
  {
    id: "lxgw-wenkai",
    label: { "zh-CN": "霞鹜文楷", en: "LXGW WenKai" },
    description: { "zh-CN": "温和中文阅读感，适合长文本和说明。", en: "Warm Chinese reading tone for longer prose and notes." },
    stack: `"LXGW WenKai Screen", "LXGW WenKai", "LXGW WenKai Mono", "Maple Mono NF CN", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`,
    probeFonts: ["LXGW WenKai Screen", "LXGW WenKai", "LXGW WenKai Mono"],
  },
  {
    id: "noto-sans-sc",
    label: { "zh-CN": "Noto Sans SC", en: "Noto Sans SC" },
    description: { "zh-CN": "Google Noto 中文无衬线，覆盖稳定、界面中性。", en: "Neutral Google Noto CJK sans with dependable coverage." },
    stack: `"Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "SimHei", sans-serif`,
    probeFonts: ["Noto Sans SC", "Noto Sans CJK SC"],
  },
  {
    id: "source-han-sans",
    label: { "zh-CN": "思源黑体", en: "Source Han Sans" },
    description: { "zh-CN": "Adobe/Google 泛 CJK 字体，专业、克制。", en: "Professional Pan-CJK sans from Adobe/Google." },
    stack: `"Source Han Sans SC", "Source Han Sans CN", "Source Han Sans", "Noto Sans CJK SC", "Microsoft YaHei UI", "Microsoft YaHei", "SimHei", sans-serif`,
    probeFonts: ["Source Han Sans SC", "Source Han Sans CN", "Source Han Sans"],
  },
  {
    id: "ibm-plex-noto",
    label: { "zh-CN": "IBM Plex + Noto", en: "IBM Plex + Noto" },
    description: { "zh-CN": "现代产品工具感，中文回退到 Noto/思源。", en: "Modern product UI feel with Noto/Source Han for CJK." },
    stack: `"IBM Plex Sans", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`,
    probeFonts: ["IBM Plex Sans"],
  },
  {
    id: "inter-noto",
    label: { "zh-CN": "Inter + Noto", en: "Inter + Noto" },
    description: { "zh-CN": "经典 SaaS/UI 字体组合，清晰紧凑。", en: "Classic SaaS/UI pairing, clear and compact." },
    stack: `"Inter", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", system-ui, sans-serif`,
    probeFonts: ["Inter"],
  },
  {
    id: "jetbrains-noto",
    label: { "zh-CN": "JetBrains Mono + Noto", en: "JetBrains Mono + Noto" },
    description: { "zh-CN": "开发者字体，代码味更明显。", en: "Developer-oriented type with stronger code flavor." },
    stack: `"JetBrains Mono", "Noto Sans Mono CJK SC", "Noto Sans SC", "Microsoft YaHei UI", ui-monospace, monospace`,
    probeFonts: ["JetBrains Mono"],
  },
  {
    id: "system",
    label: { "zh-CN": "系统默认", en: "System default" },
    description: { "zh-CN": "跟随 Windows/macOS/Linux 的系统 UI 字体。", en: "Use the platform UI font stack." },
    stack: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif`,
    probeFonts: [],
  },
];

export function readStoredAppFontId(): AppFontId {
  if (typeof window === "undefined") return "maple-mono-cn";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isAppFontId(stored) ? stored : "maple-mono-cn";
}

export function applyStoredAppFont() {
  applyAppFont(readStoredAppFontId());
}

export function setStoredAppFont(id: AppFontId) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  applyAppFont(id);
}

export function appFontOption(id: AppFontId): AppFontOption {
  return appFontOptions.find((option) => option.id === id) ?? appFontOptions[0];
}

export function detectFontAvailability(option: AppFontOption): "available" | "fallback" | "unknown" {
  if (!option.probeFonts.length) return "available";
  if (typeof document === "undefined") return "unknown";

  const canvasResult = option.probeFonts.some((font) => isFontMeasurablyAvailable(font));
  if (canvasResult) return "available";
  return typeof document.createElement === "function" ? "fallback" : "unknown";
}

function applyAppFont(id: AppFontId) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font-ui", appFontOption(id).stack);
}

function escapeFontFamily(font: string) {
  return font.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isFontMeasurablyAvailable(font: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return false;

  const text = "mmmmmmmmmmlli中文测试AaBb123";
  const size = 72;
  const escaped = escapeFontFamily(font);
  return ["monospace", "serif", "sans-serif"].some((generic) => {
    context.font = `${size}px ${generic}`;
    const baseline = context.measureText(text).width;
    context.font = `${size}px "${escaped}", ${generic}`;
    const candidate = context.measureText(text).width;
    return Math.abs(candidate - baseline) > 0.1;
  });
}

function isAppFontId(value: string | null): value is AppFontId {
  return Boolean(value && appFontOptions.some((option) => option.id === value));
}
