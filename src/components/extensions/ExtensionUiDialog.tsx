import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n";
import type { PiExtensionMessage, PiExtensionUiResponse } from "@/shared/pi/types";

interface ExtensionUiDialogProps {
  request: PiExtensionMessage | null;
  onRespond: (response: PiExtensionUiResponse) => Promise<void> | void;
}

export function ExtensionUiDialog({ request, onRespond }: ExtensionUiDialogProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = Boolean(request);
  const options = useMemo(() => request?.options ?? [], [request]);

  useEffect(() => {
    setValue(request?.prefill ?? "");
    setBusy(false);
    setError(null);
  }, [request?.id, request?.prefill]);

  if (!request) return null;
  const currentRequest = request;

  async function send(response: PiExtensionUiResponse) {
    try {
      setBusy(true);
      setError(null);
      await onRespond(response);
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function cancel() {
    void send({ id: currentRequest.id, method: currentRequest.method, cancelled: true });
  }

  function submit(nextValue?: string) {
    if (currentRequest.method === "confirm") {
      void send({ id: currentRequest.id, method: currentRequest.method, confirmed: nextValue === "true" });
      return;
    }
    void send({ id: currentRequest.id, method: currentRequest.method, value: nextValue ?? value });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? undefined : cancel())}>
      <DialogContent
        title={request.title ?? t("extension.title")}
        description={request.message ?? t("extension.description", { method: request.method })}
        className="w-[min(92vw,520px)]"
      >
        <div className="space-y-4">
          <div className="rounded-none border border-border bg-background/60 p-3 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3">
              <span>{t("extension.method")}</span>
              <span className="font-mono text-foreground">{request.method}</span>
            </div>
            {request.source ? (
              <div className="mt-2 flex justify-between gap-3">
                <span>{t("extension.source")}</span>
                <span className="truncate font-mono text-foreground">{request.source}</span>
              </div>
            ) : null}
            {request.timeoutMs ? <div className="mt-2">{t("extension.timeout", { ms: request.timeoutMs })}</div> : null}
          </div>

          {request.uiState === "expired" ? (
            <div className="rounded-none border border-warning/25 bg-warning/5 p-3 text-xs text-warning">This extension request timed out. You can still try to cancel it, but the extension may have moved on.</div>
          ) : null}

          {request.uiError || error ? <div className="rounded-none border border-danger/20 bg-danger/5 p-3 text-xs text-danger">{request.uiError ?? error}</div> : null}

          {request.method === "confirm" ? (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy || request.uiState === "submitting"} onClick={() => submit("false")}>{t("common.no")}</Button>
              <Button variant="primary" disabled={busy || request.uiState === "submitting"} onClick={() => submit("true")}>{busy || request.uiState === "submitting" ? t("common.sending") : t("common.yes")}</Button>
            </div>
          ) : null}

          {request.method === "select" ? (
            <div className="space-y-2">
              {options.length ? (
                options.map((option) => (
                  <button
                    key={option}
                    disabled={busy || request.uiState === "submitting"}
                    className="cursor-pointer w-full rounded-none border border-border bg-surface px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => submit(option)}
                  >
                    {option}
                  </button>
                ))
              ) : (
                <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noOptions")}</div>
              )}
            </div>
          ) : null}

          {request.method === "input" ? (
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>{t("extension.value")}</span>
              <input
                autoFocus
                disabled={busy || request.uiState === "submitting"}
                value={value}
                placeholder={request.placeholder}
                className="h-10 w-full rounded-none border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-60"
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
              />
            </label>
          ) : null}

          {request.method === "editor" ? (
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>{t("extension.editor")}</span>
              <textarea
                autoFocus
                disabled={busy || request.uiState === "submitting"}
                value={value}
                placeholder={request.placeholder}
                className="min-h-48 w-full resize-y rounded-none border border-border bg-surface p-3 font-mono text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-60"
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
          ) : null}

          {request.method === "input" || request.method === "editor" ? (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy || request.uiState === "submitting"} onClick={cancel}>{t("common.cancel")}</Button>
              <Button variant="primary" disabled={busy || request.uiState === "submitting"} onClick={() => submit()}>{busy || request.uiState === "submitting" ? t("common.sending") : t("common.submit")}</Button>
            </div>
          ) : request.method === "select" || request.method === "confirm" ? (
            <div className="flex justify-end">
              <Button variant="ghost" disabled={busy || request.uiState === "submitting"} onClick={cancel}>{t("common.cancel")}</Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
