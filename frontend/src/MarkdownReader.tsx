import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { remarkWikiLinks } from './markdown';

/** Render imported text without HTML execution, image requests or filesystem access. */
export default function MarkdownReader({
  body,
  onFollow,
  onCopy,
}: {
  body: string;
  onFollow: (target: string, newTab?: boolean) => void;
  onCopy: (value: string) => void;
}) {
  return (
    <Markdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkWikiLinks]}
      urlTransform={(url) => (url.startsWith('atlas-note:') ? url : defaultUrlTransform(url))}
      components={{
        a: ({ href, children }) => (
          <button
            className="markdown-link"
            title={href}
            onClick={(e) => {
              if (href?.startsWith('atlas-note:')) {
                let target = href.slice(11);
                try {
                  target = decodeURIComponent(target);
                } catch {}
                onFollow(target, e.ctrlKey || e.metaKey);
              } else if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href))
                onFollow(href, e.ctrlKey || e.metaKey);
              else if (href) onCopy(href);
            }}
          >
            {children}
          </button>
        ),
        img: ({ src, alt }) => (
          <button className="attachment-link" onClick={() => src && onFollow(src)}>
            <FileText size={14} />
            {alt || src || 'Attachment'}
          </button>
        ),
      }}
    >
      {body}
    </Markdown>
  );
}
