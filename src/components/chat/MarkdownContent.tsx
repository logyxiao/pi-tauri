import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownRemarkPlugins = [remarkGfm];
const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => <p className="mb-2.5 last:mb-0">{children}</p>,
  h1: ({ children }: { children?: ReactNode }) => <h1 className="mb-2 mt-3 text-lg font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3 className="mb-1.5 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="mb-2.5 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="mb-2.5 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }: { children?: ReactNode }) => <blockquote className="my-2 border-l-2 border-primary/45 bg-muted/45 px-3 py-2 text-muted-foreground">{children}</blockquote>,
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a className="text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  code: ({ children }: { children?: ReactNode }) => <code className="bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>,
  pre: ({ children }: { children?: ReactNode }) => <pre className="my-2 overflow-x-auto border border-border bg-background/80 p-3 text-[12px] leading-5">{children}</pre>,
  table: ({ children }: { children?: ReactNode }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
  th: ({ children }: { children?: ReactNode }) => <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }: { children?: ReactNode }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
};

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={markdownRemarkPlugins} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}
