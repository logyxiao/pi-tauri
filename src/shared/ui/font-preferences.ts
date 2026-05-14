import type { Locale } from "@/shared/i18n";

export type AppFontId = "noto-sans-sc" | "system";

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
    id: "noto-sans-sc",
    label: { "zh-CN": "Noto Sans SC", en: "Noto Sans SC" },
    description: { "zh-CN": "默认推荐：Google Noto 中文无衬线，覆盖稳定、界面中性。", en: "Default: neutral Google Noto CJK sans with dependable coverage." },
    stack: `"Noto Sans SC", "Noto Sans CJK SC", "Noto Sans CJK", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "SimHei", ui-sans-serif, system-ui, sans-serif`,
    probeFonts: ["Noto Sans SC", "Noto Sans CJK SC", "Noto Sans CJK"],
  },
  {
    id: "system",
    label: { "zh-CN": "系统默认", en: "System default" },
    description: { "zh-CN": "不依赖额外下载，跟随 Windows/macOS/Linux 的系统 UI 字体。", en: "No extra download required; use the platform UI font stack." },
    stack: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif`,
    probeFonts: [],
  },
];

export function readStoredAppFontId(): AppFontId {
  if (typeof window === "undefined") return "noto-sans-sc";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isAppFontId(stored) ? stored : "noto-sans-sc";
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
