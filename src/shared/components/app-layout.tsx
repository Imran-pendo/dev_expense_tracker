import { useEffect, useState } from "react";
import { AppNav } from "./app-nav";
import { QuickAddPalette } from "@/features/quick-add/components/quick-add-palette";
import { QuickAddTrigger } from "@/features/quick-add/components/quick-add-trigger";
import type { QuickAddOpenMethod } from "@/features/quick-add/hooks/use-quick-add";

interface AppLayoutProps {
  children: React.ReactNode;
  title: string;
  actions?: React.ReactNode;
}

export function AppLayout({ children, title, actions }: AppLayoutProps) {
  // openMethod is kept with `open` so the shortcut's toggle can record it.
  const [quickAdd, setQuickAdd] = useState<{ open: boolean; openMethod: QuickAddOpenMethod }>({
    open: false,
    openMethod: "button",
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      // The browser focuses its own search bar on Cmd/Ctrl+K otherwise.
      e.preventDefault();
      setQuickAdd((prev) => {
        // Don't open on top of another dialog (form, alert) — stacked dialogs
        // fight over focus. Closing via the shortcut is always allowed.
        if (!prev.open && document.querySelector('[data-slot="dialog-content"], [data-slot="alert-dialog-content"]')) {
          return prev;
        }
        return prev.open ? { ...prev, open: false } : { open: true, openMethod: "keyboard_shortcut" };
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-svh bg-background flex flex-col">
      <AppNav />

      <div className="max-w-[1200px] w-full mx-auto px-8 flex-1 flex flex-col">
        {/* Page header */}
        <div className="flex items-center justify-between py-5 border-b border-border/40">
          <h1 className="font-mono text-xs tracking-tight uppercase text-muted-foreground">
            {title}
          </h1>
          <div className="flex items-center gap-2">
            <QuickAddTrigger onClick={() => setQuickAdd({ open: true, openMethod: "button" })} />
            {actions}
          </div>
        </div>

        {/* Content */}
        <main className="py-8 flex-1">
          {children}
        </main>
      </div>

      <QuickAddPalette
        open={quickAdd.open}
        openMethod={quickAdd.openMethod}
        onOpenChange={(open) => setQuickAdd((prev) => ({ ...prev, open }))}
      />
    </div>
  );
}
