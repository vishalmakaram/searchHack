import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";
import { cn } from "@/lib/cn";

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "strong":
        return (
          <strong key={index} className="font-semibold text-ink">
            {renderInline(node.children)}
          </strong>
        );
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "code":
        return (
          <code key={index} className="rounded bg-surface-2 px-1 py-px font-mono text-[0.9em]">
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="break-words text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

const HEADINGS = {
  1: "text-lg font-semibold tracking-tight text-ink",
  2: "mt-2 text-[15px] font-semibold tracking-tight text-ink",
  3: "mt-1 text-sm font-semibold text-ink",
  4: "text-sm font-medium text-ink",
} as const;

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      // Document headings start below the page's own h1 and card h2.
      const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
      return (
        <Tag key={index} className={HEADINGS[block.level]}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case "paragraph":
      return <p key={index}>{renderInline(block.children)}</p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={index} className={cn("flex flex-col gap-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className="pl-1 marker:text-ink-3">
              {renderInline(item)}
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote key={index} className="flex flex-col gap-1 border-l-2 border-line-strong pl-3.5 text-ink-2">
          {block.lines.map((line, lineIndex) => (
            <p key={lineIndex}>{renderInline(line)}</p>
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre key={index} tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-surface-2 px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">
          {block.text}
        </pre>
      );
    case "rule":
      return <hr key={index} className="border-line" />;
    case "table":
      return (
        <div key={index} className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={cellIndex} scope="col" className="border-b border-line bg-surface-2/60 px-3 py-2 text-xs font-medium whitespace-nowrap text-ink-3">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-line first:border-t-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Renders a Markdown document written by the backend. Never inserts raw HTML. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return <div className={cn("flex flex-col gap-3 text-sm leading-relaxed text-ink-2", className)}>{blocks.map(renderBlock)}</div>;
}
