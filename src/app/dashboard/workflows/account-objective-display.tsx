"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MENTION_HREF_PREFIX,
  markdownWithMentionLinks,
  splitMentions,
  type MentionLabel,
  type ObjectiveMentionsView,
} from "@/app/dashboard/workflows/account-objective-copy";

/** A mention token shown by name; hovering shows the raw token (contract §1.3 "Display"). */
function MentionName({ mention }: { mention: MentionLabel }) {
  return (
    <span
      title={mention.raw}
      className={mention.resolved ? "font-medium" : "font-medium text-warning"}
      data-testid="objective-mention"
      data-resolved={mention.resolved ? "true" : "false"}
    >
      {mention.label}
    </span>
  );
}

/** Plain text with `@` mention tokens rendered as names. */
export function MentionText({ text, view }: { text: string; view: ObjectiveMentionsView }) {
  return (
    <>
      {splitMentions(text, view).map((segment, index) =>
        segment.kind === "text"
          ? <span key={`t-${index}`}>{segment.text}</span>
          : <MentionName key={`m-${index}`} mention={segment} />,
      )}
    </>
  );
}

const MARKDOWN_CLASS =
  "break-words text-sm [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-primary [&_a]:hover:underline";

/**
 * Markdown for a brief or a mentioned file's snapshot excerpt, rendered with react-markdown as
 * elsewhere in Signals. With a `view`, mention tokens render as names.
 */
export function ObjectiveMarkdown({
  content,
  view,
  className,
}: {
  content: string;
  view?: ObjectiveMentionsView;
  className?: string;
}) {
  const { markdown, labels } = view
    ? markdownWithMentionLinks(content, view)
    : { markdown: content, labels: [] as MentionLabel[] };
  return (
    <div className={`${MARKDOWN_CLASS} ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith(MENTION_HREF_PREFIX)) {
              const mention = labels[Number(href.slice(MENTION_HREF_PREFIX.length))];
              return mention ? <MentionName mention={mention} /> : <span>{children}</span>;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
