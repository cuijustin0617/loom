import { useEffect, useRef, useState, memo } from 'react';

const ModelSelector = ({ selectedModel, onModelChange, compact = false }) => {
  const models = [
    // Gemini models
    { id: 'gemini-2.5-flash+search+incremental', name: 'Gemini 2.5 Flash + Search (Live)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash+search', name: 'Gemini 2.5 Flash + Search' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-2.5-flash-lite+search', name: 'Gemini 2.5 Flash Lite + Search' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-pro+search', name: 'Gemini 2.5 Pro + Search' },
    { id: 'gemini-2.5-pro+search+incremental', name: 'Gemini 2.5 Pro + Search (Live)' },
    // OpenAI
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }
  ];

  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const current = models.find((m) => m.id === selectedModel) || models[0];

  const btnClass = compact
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-gray-200 rounded-full bg-white/70 shadow-sm hover:bg-white focus:outline-none focus:ring-2 focus:ring-violet-600'
    : 'inline-flex items-center gap-2 px-3 py-1 text-sm border border-gray-300 rounded-md bg-white shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-600';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={btnClass}
      >
        {!compact && <span className="text-gray-600">Model:</span>}
        <span className="font-medium text-gray-800 truncate max-w-[12rem] sm:max-w-none">{current.name}</span>
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className={`absolute ${compact ? 'left-0' : 'right-0'} z-10 mt-2 w-56 rounded-md border border-gray-200 bg-white shadow-lg`}>
          <ul role="listbox" aria-label="Select model" className="py-1">
            {models.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedModel === model.id}
                  onClick={() => { onModelChange(model.id); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-violet-600/10 ${
                    selectedModel === model.id ? 'text-violet-600' : 'text-gray-800'
                  }`}
                >
                  <span>{model.name}</span>
                  {selectedModel === model.id && (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 111.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default memo(ModelSelector);
