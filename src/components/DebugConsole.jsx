import { useEffect, useMemo, useState } from 'react';
import { loadDebugLogs, clearDebugLogs } from '../utils/debugConsole';

export default function DebugConsole({ visible, refreshToken }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!visible) return;
    setLogs(loadDebugLogs());
  }, [visible, refreshToken]);

  const items = useMemo(() => [...logs].reverse(), [logs]);

  if (!visible) return null;
  return (
    <div className="mt-3 border rounded-md bg-black text-green-200">
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <div className="text-sm font-semibold">Developer Console</div>
        <div className="flex items-center gap-2">
          <button onClick={() => setLogs(loadDebugLogs())} className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-200 border border-gray-600">Refresh</button>
          <button onClick={() => { clearDebugLogs(); setLogs([]); }} className="px-2 py-0.5 text-xs rounded bg-red-800 text-white border border-red-600">Clear</button>
        </div>
      </div>
      <div className="max-h-64 overflow-auto p-2 text-xs font-mono leading-relaxed">
        {items.length === 0 ? (
          <div className="text-gray-400">No debug logs.</div>
        ) : items.map((l) => (
          <div key={l.id} className="mb-2">
            <div className="text-gray-400">[{new Date(l.ts).toLocaleTimeString()}] {l.scope || 'learn'} • {l.kind || 'event'} {l.model ? `• ${l.model}` : ''} {l.status ? `• ${l.status}` : ''}</div>
            {l.messages && (
              <pre className="whitespace-pre-wrap text-green-300">{l.messages}</pre>
            )}
            {l.prompt && (
              <>
                <div className="text-gray-400">Request:</div>
                <pre className="whitespace-pre-wrap">{l.prompt}</pre>
              </>
            )}
            {l.response && (
              <>
                <div className="text-gray-400">Response:</div>
                <pre className="whitespace-pre-wrap">{l.response}</pre>
              </>
            )}
            {l.error && (
              <>
                <div className="text-red-300">Error:</div>
                <pre className="whitespace-pre-wrap text-red-300">{l.error}</pre>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

