import { Mono } from "./mono";

/** An output schema: each field a script must produce, and its type. Read-only. */
export function SchemaTable({ schema }: { schema: Record<string, string> }) {
  const fields = Object.entries(schema);
  if (fields.length === 0) return <p className="text-[13px] text-ink-3">This schema has no fields.</p>;
  return (
    <dl className="divide-y divide-line rounded-lg border border-line">
      {fields.map(([name, type]) => (
        <div key={name} className="px-3.5 py-2">
          <dt>
            <Mono className="text-ink">{name}</Mono>
          </dt>
          <dd className="mt-0.5 text-[13px] text-ink-2">{type}</dd>
        </div>
      ))}
    </dl>
  );
}
