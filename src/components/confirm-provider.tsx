import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Ctx = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({});
  const resolver = useRef<(v: boolean) => void>(() => {});

  const confirm = useCallback<Ctx>((o) => {
    setOpts(o);
    setOpen(true);
    return new Promise<boolean>((res) => {
      resolver.current = res;
    });
  }, []);

  function handleClose(v: boolean) {
    setOpen(false);
    resolver.current(v);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => !o && handleClose(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts.title ?? "Confirmer l'action"}</AlertDialogTitle>
            {opts.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleClose(false)}>{opts.cancelLabel ?? "Annuler"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleClose(true)}
              className={opts.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-brand text-brand-foreground hover:opacity-90"}
            >
              {opts.confirmLabel ?? "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
