import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

const components = {
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-4 mt-6 font-mono text-base font-medium text-aop-cream" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-3 mt-5 font-mono text-sm font-medium text-aop-cream" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-4 font-mono text-xs font-medium text-aop-cream" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-3 font-mono text-xs leading-relaxed text-aop-slate-light" {...props}>
      {children}
    </p>
  ),
  a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      className="font-mono text-aop-amber underline decoration-aop-amber/30 hover:decoration-aop-amber"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="my-3 border-l-2 border-aop-amber/40 pl-4 font-mono text-aop-slate"
      {...props}
    >
      {children}
    </blockquote>
  ),
  code: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <code
      className="rounded-aop bg-aop-charcoal/60 px-1.5 py-0.5 font-mono text-[11px] text-aop-amber-light"
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      className="my-3 overflow-x-auto rounded-aop-lg border border-aop-charcoal bg-aop-darkest p-3 font-mono text-[11px] text-aop-slate-light"
      {...props}
    >
      {children}
    </pre>
  ),
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse font-mono text-xs" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th
      className="border border-aop-charcoal bg-aop-dark px-3 py-1.5 text-left font-mono text-xs text-aop-cream"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td
      className="border border-aop-charcoal px-3 py-1.5 font-mono text-xs text-aop-slate-light"
      {...props}
    >
      {children}
    </td>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="my-2 list-inside list-disc space-y-1 font-mono text-xs text-aop-slate-light"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="my-2 list-inside list-decimal space-y-1 font-mono text-xs text-aop-slate-light"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li className="font-mono text-xs text-aop-slate-light" {...props}>
      {children}
    </li>
  ),
  input: (props: React.InputHTMLAttributes<HTMLInputElement>) => {
    if (props.type === "checkbox") {
      return <input {...props} disabled className="aop-checkbox" />;
    }
    return <input {...props} />;
  },
  hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
    <hr className="my-4 border-aop-charcoal" {...props} />
  ),
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-medium text-aop-cream" {...props}>
      {children}
    </strong>
  ),
};

const plugins = { code };

interface MarkdownViewerProps {
  content: string;
}

export const MarkdownViewer = ({ content }: MarkdownViewerProps) => (
  <div className="markdown-viewer" data-testid="markdown-viewer">
    <Streamdown plugins={plugins} components={components}>
      {content}
    </Streamdown>
  </div>
);
