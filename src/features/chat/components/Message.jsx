import React, { useMemo, useState, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { defaultSchema } from 'hast-util-sanitize';
import { normalizeText } from '../../../shared/utils/normalize';

const extractSources = (text) => {
  if (!text || typeof text !== 'string') return { main: text, sources: [] };
  const marker = '\n\nSources:\n';
  let idx = text.lastIndexOf(marker);
  if (idx === -1) {
    const marker2 = '\nSources:\n';
    idx = text.lastIndexOf(marker2);
  }
  if (idx === -1) return { main: text, sources: [] };
  const main = text.slice(0, idx).trimEnd();
  const tail = text.slice(idx).replace(/^\s*/, '');
  const lines = tail.split(/\n/);
  const items = lines.slice(1).filter((l) => l.trim().startsWith('- '));
  const sources = items.map((l) => {
    const m = l.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)/);
    if (m) return { title: m[1], url: m[2] };
    return { title: l.replace(/^-\s*/, ''), url: undefined };
  });
  return { main, sources };
};

const sanitizeSchema = (() => {
  try {
    if (defaultSchema && typeof defaultSchema === 'object') {
      return { ...defaultSchema, tagNames: [...(defaultSchema.tagNames || []), 'br'] };
    }
  } catch {}
  return { tagNames: ['p','strong','em','code','pre','h1','h2','h3','ul','ol','li','table','thead','tbody','tr','th','td','a','br','span','div'] };
})();

// Extract a human-friendly host and an unwrapped destination URL.
// Many providers return aggregator/redirector URLs (e.g., vertexaisearch) with the true URL
// embedded in query params. We try to unwrap those for display and linking.
const getDisplayLink = (rawUrl) => {
  let href = rawUrl;
  let host = '';
  try {
    const u = new URL(rawUrl);
    // Try to find a full URL inside query params
    const tryVals = [];
    for (const [k, v] of u.searchParams) {
      if (!v) continue;
      tryVals.push(v);
      try {
        const dec = decodeURIComponent(v);
        if (dec !== v) tryVals.push(dec);
      } catch {}
    }
    const inner = tryVals.find((v) => /^https?:\/\//i.test(v));
    if (inner) {
      href = inner;
    } else {
      // Also check decoded pathname for embedded http(s)
      try {
        const p = decodeURIComponent(u.pathname);
        const m = p.match(/https?:\/\/[^\s)]+/i);
        if (m) href = m[0];
      } catch {}
    }
  } catch {}
  try {
    const uh = new URL(href).hostname;
    host = uh.replace(/^www\./, '');
  } catch {
    host = href;
  }
  return { href, host };
};

const CodeBlock = ({ code, isUser }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleCopy}
        className={`absolute right-2 top-2 text-xs px-2 py-1 rounded border shadow-sm ${
          isUser ? 'bg-violet-700/60 text-white border-white/20' : 'bg-white text-gray-600 border-gray-200'
        }`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className={`p-3 rounded overflow-x-auto ${isUser ? 'bg-violet-600/60' : 'bg-gray-200'}`}>
        <code className="font-mono text-xs whitespace-pre">{code}</code>
      </pre>
    </div>
  );
};

const Message = ({ message }) => {
  const isUser = message.role === 'user';
  const isError = message.isError;
  const { main: assistantMain, sources: assistantSources } =
    !isUser ? extractSources(message.content) : { main: message.content, sources: [] };

  // Create citation mapping based on order of appearance and map to sources
  let assistantMainLinked = assistantMain;
  if (!isUser && assistantSources.length > 0 && typeof assistantMain === 'string') {
    // Convert superscript digits like ¹² to [12] so we can link them too
    const supMap = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9' };
    const convertSuperscripts = (s) => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `[${m.split('').map(ch => supMap[ch] ?? '').join('')}]`);
    const prepared = convertSuperscripts(assistantMain);

    // Collect all cited numbers in order of appearance (supports groups like [1, 3,9])
    const numbersInText = [];
    const seen = new Set();
    const groupRe = /\[((?:\d+\s*(?:,\s*)?)+)\](?!\()/g;
    let gm;
    while ((gm = groupRe.exec(prepared)) !== null) {
      const parts = gm[1].split(/\s*,\s*/).filter(Boolean);
      for (const n of parts) {
        if (!seen.has(n)) { seen.add(n); numbersInText.push(n); }
      }
    }

    // Build mapping: try direct numeric index first (n -> sources[n-1]),
    // then fall back to remaining sources by order if needed
    const numToUrl = new Map();
    const usedSourceIdx = new Set();
    for (const n of numbersInText) {
      const idx = parseInt(n, 10);
      if (!Number.isNaN(idx) && idx >= 1 && idx <= assistantSources.length) {
        numToUrl.set(n, assistantSources[idx - 1].url);
        usedSourceIdx.add(idx - 1);
      }
    }
    let nextIdx = 0;
    for (const n of numbersInText) {
      if (!numToUrl.has(n)) {
        while (nextIdx < assistantSources.length && usedSourceIdx.has(nextIdx)) nextIdx++;
        if (nextIdx < assistantSources.length) {
          numToUrl.set(n, assistantSources[nextIdx].url);
          usedSourceIdx.add(nextIdx);
          nextIdx++;
        }
      }
    }

    assistantMainLinked = prepared.replace(groupRe, (_full, inner) => {
      const nums = inner.split(/\s*,\s*/).filter(Boolean);
      const linked = nums.map((n) => {
        const url = numToUrl.get(n);
        return url ? `[${n}](${url})` : `[${n}]`;
      });
      return linked.join(', ');
    });
    // Collapse duplicate adjacent bracketed numbers: [1] [1] or [1], [1]
    assistantMainLinked = assistantMainLinked.replace(/(\[(\d+)\])(?:\s*,?\s*\[\2\])+?/g, '$1');
  }

  const mdComponents = useMemo(() => ({
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
    h2: ({ children }) => <h2 className="text-base font-bold mb-2">{children}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
    ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
    table: ({ children }) => (
      <div className="my-2 rounded-xl border border-violet-200 overflow-hidden shadow-sm bg-white">
        <table className="w-full border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-violet-50/60 text-gray-700">{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="even:bg-violet-50/20">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="text-left text-sm font-semibold px-3 py-2 border-b border-violet-100 align-top">{children}</th>
    ),
    td: ({ children }) => (
      <td className="text-sm px-3 py-2 border-b border-violet-100 align-top">{children}</td>
    ),
    code: ({ inline, children }) => {
      const text = String(children ?? '');
      const shouldBeInline = inline ?? !/\n/.test(text);
      if (shouldBeInline) {
        return (
          <code className={`inline px-1 py-0.5 rounded ${isUser ? 'bg-violet-600/10' : 'bg-gray-200'} font-mono whitespace-pre-wrap break-words align-baseline max-w-full`}>
            {children}
          </code>
        );
      }
      return <CodeBlock isUser={isUser} code={text.replace(/\n$/, '')} />;
    },
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`${isUser ? 'text-violet-700' : 'text-violet-600'} underline inline-block truncate max-w-full align-baseline`}
        title={typeof children === 'string' ? children : undefined}
      >
        {children}
      </a>
    ),
  }), [isUser]);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 px-1 w-full min-w-0`}>
      {isUser ? (
        <div className={`inline-block max-w-[min(96%,720px)] px-3 sm:px-4 py-2 rounded-lg break-words min-w-0 ${'bg-violet-600/15 border border-violet-200 text-gray-900'}`}>
          {Array.isArray(message.attachments) && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map((att, idx) => {
                const isImage = att.mimeType?.startsWith('image/');
                const dataUrl = att.base64 && att.mimeType ? `data:${att.mimeType};base64,${att.base64}` : null;
                return (
                  <div key={idx} className="border border-violet-200 rounded-md p-1 bg-white/70">
                    {isImage && dataUrl ? (
                      <img src={dataUrl} alt={att.name || `image-${idx}`} className="h-20 w-20 object-cover rounded" />
                    ) : (
                      <div className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700">
                        <svg className="h-4 w-4 text-violet-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                          <path d="M14 2v6h6"/>
                        </svg>
                        <span className="max-w-[160px] truncate" title={att.name}>{att.name || 'Attachment'}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-sm leading-relaxed break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
              components={mdComponents}
            >
              {normalizeText(message.content)}
            </ReactMarkdown>
          </div>
          <div className={`text-xs mt-1 text-violet-500`}>
            {message.createdAt ? new Date(message.createdAt).toLocaleTimeString() : ''}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start w-full min-w-0 ml-8">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-600 mb-1.5 select-none">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>
              <path d="M7.5 7.5l2.5 2.5M14 14l2.5 2.5M16.5 7.5L14 10M10 14l-2.5 2.5"/>
            </svg>
            <span className="tracking-wide">LOOM</span>
          </div>
          <div className={`inline-block max-w-[min(98%,720px)] px-3 sm:px-4 py-2 rounded-lg break-words min-w-0 ${isError ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-white border border-violet-200 text-gray-800'}`}>
            {Array.isArray(message.attachments) && message.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.attachments.map((att, idx) => {
                  const isImage = att.mimeType?.startsWith('image/');
                  const dataUrl = att.base64 && att.mimeType ? `data:${att.mimeType};base64,${att.base64}` : null;
                  return (
                    <div key={idx} className="border border-violet-200 rounded-md p-1 bg-white/70">
                      {isImage && dataUrl ? (
                        <img src={dataUrl} alt={att.name || `image-${idx}`} className="h-20 w-20 object-cover rounded" />
                      ) : (
                        <div className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700">
                          <svg className="h-4 w-4 text-violet-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <path d="M14 2v6h6"/>
                          </svg>
                          <span className="max-w-[160px] truncate" title={att.name}>{att.name || 'Attachment'}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="text-sm leading-relaxed break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                components={mdComponents}
              >
                {normalizeText(assistantMainLinked)}
              </ReactMarkdown>
            </div>
            {assistantSources && assistantSources.length > 0 && (
              <div className="mt-1 border-t border-violet-100 pt-1">
                <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap no-scrollbar text-[11px] text-gray-600">
                  {(() => {
                    // For the bar, list unique numbers by order of appearance (incl. superscripts)
                    const prepared = assistantMainLinked; // already converted superscripts earlier if needed
                    const order = [];
                    const seen = new Set();
                    const groupRe = /\[((?:\d+\s*(?:,\s*)?)+)\](?!\()/g;
                    let gm;
                    while ((gm = groupRe.exec(prepared)) !== null) {
                      const parts = gm[1].split(/\s*,\s*/).filter(Boolean);
                      for (const n of parts) { if (!seen.has(n)) { seen.add(n); order.push(n); } }
                    }
                    const items = [];
                    for (let i = 0; i < order.length && i < assistantSources.length; i++) {
                      const n = order[i];
                      // Try numeric index first, then fallback to position i
                      let url;
                      const idx = parseInt(n, 10);
                      if (!Number.isNaN(idx) && idx >= 1 && idx <= assistantSources.length) url = assistantSources[idx - 1].url;
                      if (!url) url = assistantSources[i].url;
                      const { href, host } = getDisplayLink(url);
                      items.push(
                        <span key={n} className="inline-flex items-center gap-1">
                          <a href={href} target="_blank" rel="noreferrer" className="text-violet-600 underline">[{n}]</a>
                          <a href={href} target="_blank" rel="noreferrer" className="text-gray-600 hover:underline">{host || href}</a>
                        </span>
                      );
                    }
                    return items;
                  })()}
                </div>
              </div>
            )}
            <div className={`text-xs mt-1 ${isError ? 'text-red-500' : 'text-gray-500'}`}>
              {message.createdAt ? new Date(message.createdAt).toLocaleTimeString() : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(Message, (prev, next) => prev.message === next.message);
