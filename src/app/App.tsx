import { AppShell } from "@/components/layout/AppShell";
import { I18nProvider } from "@/shared/i18n";

export function App() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
}
