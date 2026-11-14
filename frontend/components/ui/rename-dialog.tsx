"use client";

import { useId, useState } from "react";
import { errorMessage } from "@/lib/api";
import { Notice } from "@/components/status/notice";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Input } from "./field";

interface RenameDialogProps {
  open: boolean;
  onClose: () => void;
  /** "Rename webhook" */
  title: string;
  initial: string;
  onSave: (name: string) => Promise<unknown>;
}

export function RenameDialog({ open, onClose, title, initial, onSave }: RenameDialogProps) {
  if (!open) return null;
  // Mounted fresh each time it opens, so the field starts from the current name.
  return <RenameForm onClose={onClose} title={title} initial={initial} onSave={onSave} />;
}

function RenameForm({ onClose, title, initial, onSave }: Omit<RenameDialogProps, "open">) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const inputId = useId();
  const trimmed = name.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!trimmed || trimmed === initial}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor={inputId} className="sr-only">
          Name
        </label>
        <Input id={inputId} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus />
        {error ? <Notice tone="red">{error}</Notice> : null}
      </form>
    </Dialog>
  );
}
