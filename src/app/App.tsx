import { AppShell } from "@/components/layout/AppShell";
import { I18nProvider } from "@/shared/i18n";
import { applyStoredAppFont } from "@/shared/ui/font-preferences";

applyStoredAppFont();

export function App() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
}
