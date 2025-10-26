import { useEffect, useMemo, useState } from 'react';
import { getSessionContent, generateQuickCheck } from '../services/explore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { defaultSchema } from 'hast-util-sanitize';
import { normalizeText } from '../utils/normalize';
import { getCachedSession, setCachedSession } from '../utils/exploreStorage';

export default function ExploreSessionModal({ open, card, onClose, onComplete }) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  // Extract a trailing JSON quiz code block if present
  const extractQuizJSON = (text) => {
    const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/gi; // accept json or unlabeled fences
    let match;
    let last = null;
    while ((match = fenceRe.exec(text)) !== null) last = match;
    if (!last) return { stripped: text, quiz: null };
    const jsonRaw = last[1];
    let quiz = null;
    try {
      const obj = JSON.parse(jsonRaw);
      if (obj && obj.quiz && Array.isArray(obj.quiz.questions)) quiz = obj.quiz;
    } catch {}
    if (!quiz) return { stripped: text, quiz: null };
    const before = text.slice(0, last.index).trimEnd();
    const after = text.slice(last.index + last[0].length).trim();
    const stripped = [before, after].filter(Boolean).join('\n\n');
    return { stripped, quiz };
  };

  const extractSources = (text) => {
    if (!text || typeof text !== 'string') return { main: text, sources: [] };
    const lines = String(text).split(/\n/);
    const out = [];
    const collected = [];
    let inCode = false;
    let inSources = false;

    // Recognize common headings and variations
    const headingWords = ['Sources', 'References', 'Citations', 'Further Reading', 'Bibliography', 'Links'];
    const isHeadingLine = (s) => {
      const t = s.trim();
      if (!t) return false;
      // Strip common markdown heading/emphasis markers
      const stripped = t
        .replace(/^>\s*/, '')
        .replace(/^#{1,6}\s*/, '')
        .replace(/^[*_]{0,3}\s*/, '')
        .replace(/[*_]{0,3}\s*$/, '');
      // Allow trailing colon
      const base = stripped.replace(/:\s*$/, '').trim();
      return headingWords.some((w) => base.toLowerCase() === w.toLowerCase());
    };

    const bulletRe = /^\s*(?:[-*+]|\d+[\.)])\s+/; // - item or 1. item
    const mdLinkReG = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/ig;
    const urlReG = /https?:\/\/[^\s)]+/ig;

    const pushLinksInText = (textLine) => {
      // Extract markdown links
      let m;
      let found = false;
      while ((m = mdLinkReG.exec(textLine)) !== null) {
        collected.push({ title: m[1], url: m[2] });
        found = true;
      }
      // Extract bare URLs
      const urls = textLine.match(urlReG) || [];
      for (const u of urls) {
        collected.push({ title: u, url: u });
        found = true;
      }
      return found;
    };

    // Lookahead helper: do we have a list or links after a heading?
    const hasFollowingListOrLinks = (startIdx) => {
      for (let j = startIdx + 1; j < Math.min(lines.length, startIdx + 12); j++) {
        const raw = lines[j];
        const t = raw.trim();
        if (t === '') continue; // skip blanks
        if (t.startsWith('```')) return false; // a code block starts — bail
        if (bulletRe.test(raw)) return true;
        if (pushLinksInText(t)) { return true; }
        return false;
      }
      return false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track fenced code blocks to avoid stripping inside code
      if (trimmed.startsWith('```')) {
        inCode = !inCode;
        if (!inSources) out.push(line);
        continue;
      }

      if (!inCode && !inSources && isHeadingLine(trimmed) && hasFollowingListOrLinks(i)) {
        // Enter sources block; also capture links on the same header line (e.g., "Sources: [a](u)")
        inSources = true;
        pushLinksInText(trimmed);
        continue;
      }

      if (inSources) {
        const hasBullet = bulletRe.test(line);
        const hasLinks = pushLinksInText(trimmed);
        if (trimmed === '' || hasBullet || hasLinks) {
          // Keep absorbing sources lines
          continue;
        }
        // Any other content ends the sources block; emit it into main
        inSources = false;
        out.push(line);
        continue;
      }

      // Normal content
      out.push(line);
    }

    // Deduplicate (prefer URL key)
    const uniq = [];
    const seen = new Set();
    for (const s of collected) {
      const key = (s.url ? `u:${s.url}` : `t:${s.title || ''}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(s);
    }

    return { main: out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(), sources: uniq };
  };

  const sanitizeSchema = useMemo(() => {
    try {
      if (defaultSchema && typeof defaultSchema === 'object') {
        return { ...defaultSchema, tagNames: [...(defaultSchema.tagNames || []), 'br'] };
      }
    } catch {}
    return { tagNames: ['p','strong','em','code','pre','h1','h2','h3','ul','ol','li','table','thead','tbody','tr','th','td','a','br','span','div'] };
  }, []);
  const rehypePluginsSafe = useMemo(() => {
    const list = [rehypeKatex];
    if (sanitizeSchema && sanitizeSchema.tagNames) {
      list.push(rehypeRaw);
      list.push([rehypeSanitize, sanitizeSchema]);
    }
    return list;
  }, [sanitizeSchema]);

  const { stripped: withoutQuiz, quiz } = useMemo(() => extractQuizJSON(content || ''), [content]);
  const normalizedQuiz = useMemo(() => {
    if (!quiz || !Array.isArray(quiz.questions)) return null;
    const qs = quiz.questions.map((q, idx) => {
      const choices = Array.isArray(q.choices) ? q.choices.slice(0, 4) : [];
      while (choices.length < 4) choices.push('');
      const answerIndex = Math.max(0, Math.min(3, Number(q.answerIndex)));
      return { id: String(q.id || `q${idx+1}`), text: String(q.text || ''), choices, answerIndex, explanation: String(q.explanation || '') };
    });
    return { questions: qs };
  }, [quiz]);
  const { main: mainText, sources } = useMemo(() => extractSources(withoutQuiz), [withoutQuiz]);

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
          <code className={`inline px-1 py-0.5 rounded bg-gray-200 font-mono whitespace-pre-wrap break-words align-baseline max-w-full`}>
            {children}
          </code>
        );
      }
      return (
        <pre className="p-3 rounded overflow-x-auto bg-gray-200">
          <code className="font-mono text-xs whitespace-pre">{text.replace(/\n$/, '')}</code>
        </pre>
      );
    },
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer" className={`text-violet-600 underline inline-block truncate max-w-full align-baseline`}>
        {children}
      </a>
    ),
  }), []);

  // Quiz state and evaluation
  const [answers, setAnswers] = useState({}); // id -> index
  const [submitted, setSubmitted] = useState(false);
  const [allCorrect, setAllCorrect] = useState(false);

  const answeredAll = useMemo(() => {
    if (!quiz?.questions) return false;
    return quiz.questions.every((q) => Number.isInteger(answers[q.id]));
  }, [answers, quiz]);

  const evaluate = () => {
    if (!quiz?.questions) return false;
    const ok = quiz.questions.every((q) => Number.isInteger(answers[q.id]) && answers[q.id] === Number(q.answerIndex));
    setAllCorrect(ok);
    setSubmitted(true);
    return ok;
  };
  const resetQuiz = () => { setAnswers({}); setSubmitted(false); setAllCorrect(false); };

  // Always reset quiz state when opening a session or switching cards
  useEffect(() => {
    if (open) resetQuiz();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError('');
      setContent('');
      try {
        const cached = getCachedSession(card?.id);
        if (cached) {
          if (!cancelled) { setContent(cached); setLoading(false); }
          return;
        }
        const res = await getSessionContent({ card });
        if (!cancelled) {
          setContent(res.text || '');
          if (res?.text) setCachedSession(card?.id, res.text);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [open, card]);

  // If no quiz block present but needed, try to fetch one
  useEffect(() => {
    let cancelled = false;
    const needQuiz = (card?.mode === 'Read' || card?.mode === 'Quiz') && open;
    if (!needQuiz) return;
    if (quiz && quiz.questions && quiz.questions.length > 0) return;
    const run = async () => {
      try {
        const res = await generateQuickCheck({ card, minutes: card?.minutes, reading: withoutQuiz });
        if (!cancelled && res?.quiz) {
          // Synthesize a JSON fence and append to content so it parses normally on reopen
          const block = '\n\n```json\n' + JSON.stringify({ quiz: res.quiz }) + '\n```\n';
          const next = (content || '') + block;
          setContent(next);
          setCachedSession(card?.id, next);
        }
      } catch {}
    };
    run();
    return () => { cancelled = true; };
  }, [quiz, open, card, withoutQuiz, content]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[min(900px,96vw)] max-h-[86vh] overflow-hidden rounded-2xl bg-white shadow-xl border border-emerald-200">
        <div className="px-4 py-3 border-b border-emerald-200 flex items-center justify-between bg-emerald-50/60">
          <div className="font-semibold text-emerald-800 truncate pr-2">{card?.title || 'Session'}</div>
          <div className="text-xs text-gray-600">{card?.minutes} min • {card?.mode}</div>
        </div>
        <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(86vh - 112px)' }}>
          {loading && <div className="text-emerald-700">Generating…</div>}
          {error && <div className="text-red-700">{error}</div>}
          {!loading && !error && (
            <div className="text-sm leading-relaxed break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={rehypePluginsSafe}
                components={mdComponents}
              >
                {normalizeText(mainText)}
              </ReactMarkdown>
              {normalizedQuiz?.questions && normalizedQuiz.questions.length > 0 && (
                <div className="mt-4 border border-emerald-200 rounded-lg p-3 bg-emerald-50/50">
                  <div className="text-sm font-semibold text-emerald-900 mb-2">Quick Check</div>
                  <div className="space-y-3">
                    {normalizedQuiz.questions.map((q, qi) => {
                      const selected = answers[q.id];
                      const correct = Number(q.answerIndex);
                      const isSubmitted = submitted;
                      const isCorrect = isSubmitted && selected === correct;
                      const isWrong = isSubmitted && Number.isInteger(selected) && selected !== correct;
                      return (
                        <div key={q.id} className={`rounded-md border p-2 ${isCorrect ? 'border-emerald-400 bg-white' : isWrong ? 'border-red-300 bg-white' : 'border-emerald-200 bg-white'}`}>
                          <div className="text-sm font-medium text-gray-900 mb-1">{qi + 1}. {q.text}</div>
                          <div className="flex flex-col gap-1">
                            {(q.choices || []).map((c, ci) => {
                              const active = selected === ci;
                              const correctChoice = isSubmitted && ci === correct;
                              const wrongChoice = isSubmitted && active && ci !== correct;
                              return (
                                <button
                                  key={ci}
                                  onClick={() => setAnswers(a => ({ ...a, [q.id]: ci }))}
                                  className={`text-left px-2 py-1 rounded border ${active ? 'border-emerald-500 bg-emerald-50' : 'border-emerald-200 hover:bg-emerald-50'} ${correctChoice ? 'border-emerald-500 bg-emerald-50' : ''} ${wrongChoice ? 'border-red-300 bg-red-50' : ''}`}
                                >
                                  <span className="text-xs font-medium mr-1">{String.fromCharCode(65 + ci)}.</span> {c}
                                </button>
                              );
                            })}
                          </div>
                          {isSubmitted && (
                            <div className={`mt-2 text-xs ${isCorrect ? 'text-emerald-700' : 'text-gray-600'}`}>{q.explanation || (isCorrect ? 'Correct.' : 'Review the content and try again.')}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button disabled={!answeredAll} onClick={() => evaluate()} className={`px-3 py-1.5 text-sm rounded-md text-white ${answeredAll ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-emerald-400/60 cursor-not-allowed'}`}>Submit</button>
                    {submitted && !allCorrect && (
                      <button onClick={resetQuiz} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Retry</button>
                    )}
                    {submitted && allCorrect && (
                      <div className="text-emerald-700 text-sm">Great job — all correct!</div>
                    )}
                  </div>
                </div>
              )}
              {sources && sources.length > 0 && (
                <div className="mt-3 border-t border-violet-100 pt-2">
                  <div className="text-xs text-gray-600 font-semibold mb-1">Sources</div>
                  <div className="flex flex-col gap-1 text-xs">
                    {sources.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        {s.url ? (
                          <>
                            <a className="text-violet-600 underline" href={s.url} target="_blank" rel="noreferrer">[{i+1}]</a>
                            <a className="text-gray-600 hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
                          </>
                        ) : (
                          <>
                            <span className="text-gray-500">[{i+1}]</span>
                            <span className="text-gray-600">{s.title || 'Source'}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-emerald-200 flex items-center justify-end gap-2 bg-white">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Close</button>
          <button onClick={onComplete} disabled={normalizedQuiz?.questions?.length > 0 && !allCorrect} className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">Complete</button>
        </div>
      </div>
    </div>
  );
}
