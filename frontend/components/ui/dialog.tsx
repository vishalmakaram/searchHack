"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { Notice } from "@/components/status/notice";
import { Button, IconButton } from "./button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned at the bottom. */
  footer?: ReactNode;
}

/**
 * A modal built on the native <dialog>, which supplies the focus trap, the
 * Escape key and the inert background.
 */
export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return <OpenDialog {...props} />;
}

function OpenDialog({ onClose, title, description, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = ref.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] animate-enter rounded-2xl border border-line bg-surface p-0 text-ink shadow-pop"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description ? <div className="mt-1 text-sm text-ink-2">{description}</div> : null}
        </div>
        <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-1.5">
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
      {children ? <div className="px-5 pt-4">{children}</div> : null}
      <div className="flex flex-wrap justify-end gap-2 px-5 pt-5 pb-5">{footer}</div>
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  /** Runs when confirmed. The dialog closes when it resolves and shows the error if it rejects. */
  onConfirm: () => Promise<unknown>;
}

export function ConfirmDialog({ open, onClose, title, description, confirmLabel, danger, onConfirm }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : close}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={confirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="red">{error}</Notice> : null}
    </Dialog>
  );
}
