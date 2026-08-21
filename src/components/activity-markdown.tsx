"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ActivityMarkdownProps = {
  content: string;
};

export function ActivityMarkdown({ content }: ActivityMarkdownProps) {
  return (
    <div className="text-sm [&_h1]:mt-0 [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-0 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-0 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0 [&_a]:text-primary [&_a]:hover:underline">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
