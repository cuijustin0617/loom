import { useState, useEffect, useRef, useCallback } from 'react';
import Message from './Message';
import ModelSelector from './ModelSelector';
// settings are managed via Profile menu modal

const ChatInterface = ({ 
  conversation, 
  isLoading, 
  onSendMessage, 
  selectedModel, 
  onModelChange 
}) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]); // { name, mimeType, size, base64 }
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputTopRef = useRef(null);
  const fileInputBottomRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Auto-scroll behavior: In live (incremental) mode, only follow if user is near bottom.
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(!selectedModel?.includes('+incremental'));

  useEffect(() => {
    const isLive = selectedModel?.includes('+incremental');
    // When switching modes: disable auto-scroll in live, enable in non-live
    setAutoScrollEnabled(!isLive);
  }, [selectedModel]);

  useEffect(() => {
    const isLive = selectedModel?.includes('+incremental');
    if (!isLive || autoScrollEnabled) {
      scrollToBottom();
    }
  }, [conversation?.messages, selectedModel, autoScrollEnabled]);

  const submit = () => {
    const hasText = !!input.trim();
    const hasFiles = attachments.length > 0;
    if ((!hasText && !hasFiles) || isLoading) return;
    onSendMessage({ text: input.trim(), attachments: attachments.slice() });
    setInput('');
    setAttachments([]);
    // reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submit();
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    // autosize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }
    // Shift+Enter = newline (default). Plain Enter inserts newline by default.
  };

  const readFilesAsAttachments = useCallback(async (files) => {
    const toRead = files.slice(0, 3); // limit to 3 per add
    const readAsBase64 = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result || '';
        // result is a data URL: data:<mime>;base64,<data>
        const commaIdx = String(result).indexOf(',');
        const base64 = commaIdx !== -1 ? String(result).slice(commaIdx + 1) : '';
        resolve({ name: file.name, mimeType: file.type, size: file.size, base64 });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const processed = await Promise.all(toRead.map(readAsBase64));
    setAttachments(prev => [...prev, ...processed]);
  }, []);

  const handleScroll = (e) => {
    const isLive = selectedModel?.includes('+incremental');
    if (!isLive) return; // Non-live keeps default always-follow behavior elsewhere
    const el = e.currentTarget;
    const threshold = 24; // px tolerance from bottom
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
    setAutoScrollEnabled(atBottom);
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      await readFilesAsAttachments(files);
      // Reset the input so the same file can be re-selected
      e.target.value = '';
    } catch {
      // ignore
    }
  };

  // Drag & Drop support for images/PDFs
  const acceptsFile = (file) => {
    if (!file || !file.type) return false;
    return file.type.startsWith('image/') || file.type === 'application/pdf';
  };

  // Stabilize drag UI with global listeners + nested enter/leave counter
  useEffect(() => {
    const hasFiles = (evt) => {
      const types = Array.from(evt?.dataTransfer?.types || []);
      if (types.includes('Files')) return true;
      const items = Array.from(evt?.dataTransfer?.items || []);
      return items.some((it) => it.kind === 'file');
    };

    const onDragEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDragging(true);
    };

    const onDragOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch {}
    };

    const onDragLeave = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    };

    const onDrop = async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const list = Array.from(e.dataTransfer?.files || []);
      const filtered = list.filter(acceptsFile);
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (filtered.length === 0) return;
      try {
        await readFilesAsAttachments(filtered);
      } catch {}
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [readFilesAsAttachments]);

  const removeAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-2xl font-tech font-bold text-loom-blue mb-2">
            LOOM
          </div>
          <div className="text-gray-500">
            Start a new conversation to begin chatting
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white">
      {/* Header with Model Selector */}
      <div className="sticky top-0 z-10 border-b border-violet-200/70 bg-white/70 backdrop-blur px-3 sm:px-6 py-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-800 truncate">
            {conversation.title}
          </h2>
          <ModelSelector 
            selectedModel={selectedModel} 
            onModelChange={onModelChange}
          />
        </div>
        {/* Settings moved into Profile menu; keep header clean */}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
        {conversation.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-full max-w-2xl px-6">
              <div className="mx-auto mb-4 h-14 w-14 rounded-xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white flex items-center justify-center shadow-sm">
                <svg className="h-7 w-7 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>
                  <path d="M7.5 7.5l2.5 2.5M14 14l2.5 2.5M16.5 7.5L14 10M10 14l-2.5 2.5"/>
                </svg>
              </div>
                <div className="text-center">
                <div className="text-2xl font-tech font-bold text-loom-blue mb-1">LOOM</div>
                <h2 className="text-xl font-semibold text-gray-800 mb-3">Where should we begin?</h2>
              </div>
              <form onSubmit={handleSubmit}>
                <div
                  className={`flex flex-col gap-1 rounded-2xl border border-gray-300 bg-white shadow-sm px-4 pt-3 pb-2 ${
                    isDragging ? 'ring-2 ring-violet-500 ring-offset-2' : ''
                  }`}
                >
                  {/* Row 1: text field only */}
                  <div className="flex items-start">
                    <textarea
                      ref={textareaRef}
                      rows={2}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask anything"
                      disabled={isLoading}
                      className="w-full bg-transparent border-0 focus:outline-none resize-none text-gray-800 placeholder:text-gray-400"
                    />
                  </div>
                  {/* Row 2: + button left with model selector; send on the right */}
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputTopRef.current?.click()}
                        className="p-2 rounded-full hover:bg-gray-100 text-gray-700"
                        title="Attach files"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M5 12h14"/>
                        </svg>
                      </button>
                      <input
                        ref={fileInputTopRef}
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        onChange={handleFileChange}
                        className="hidden"
                        disabled={isLoading}
                      />
                      <div className="opacity-80">
                        <ModelSelector compact selectedModel={selectedModel} onModelChange={onModelChange} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-[11px] text-gray-400 select-none">Enter = newline • Cmd/Ctrl+Enter = send</div>
                      <button
                        type="submit"
                        disabled={(!input.trim() && attachments.length === 0) || isLoading}
                        className="p-2.5 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed shadow"
                        title="Send"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 2L11 13"/>
                          <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </form>
              {/* Attachments Preview for empty-state composer */}
              {attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {attachments.map((att, idx) => {
                    const isImage = (att.mimeType || '').startsWith('image/');
                    const dataUrl = `data:${att.mimeType};base64,${att.base64}`;
                    return (
                      <div key={idx} className="group relative border border-violet-200 rounded-md p-2 bg-white shadow-sm">
                        {isImage ? (
                          <img src={dataUrl} alt={att.name} className="h-16 w-16 object-cover rounded" />
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-gray-700">
                            <svg className="h-5 w-5 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                              <path d="M14 2v6h6"/>
                            </svg>
                            <span className="max-w-[180px] truncate" title={att.name}>{att.name}</span>
                          </div>
                        )}
                        <button type="button" onClick={() => removeAttachment(idx)} className="absolute -top-2 -right-2 bg-white border border-gray-300 rounded-full p-0.5 shadow hover:bg-gray-50">
                          <svg className="h-4 w-4 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {isDragging && (
                <div className="mt-4 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/60 text-violet-700 flex items-center justify-center py-12 text-sm">
                  Drop your file to attach
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {conversation.messages.map((message, index) => {
              const key = message.id || message._streamId || message.timestamp || index;
              return <Message key={key} message={message} />;
            })}
            {isDragging && (
              <div className="my-3">
                <div className="rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/60 text-violet-700 flex items-center justify-center py-12 text-sm">
                  Drop your file to attach
                </div>
              </div>
            )}
            {isLoading && (
              <div className="flex justify-start mb-4">
                <div className="bg-gray-100 text-gray-800 max-w-xs lg:max-w-md px-4 py-2 rounded-lg">
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Bottom Input: only after conversation has started */}
      {conversation.messages.length > 0 && (
      <div className={`sticky bottom-0 z-10 border-t border-violet-200/70 bg-white/70 backdrop-blur px-3 sm:px-6 ${isDragging ? 'pt-6 pb-10' : 'pt-4 pb-6'}`}>
        {/* Attachments Preview */}
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((att, idx) => {
              const isImage = att.mimeType.startsWith('image/');
              const dataUrl = `data:${att.mimeType};base64,${att.base64}`;
              return (
                <div key={idx} className="group relative border border-violet-200 rounded-md p-2 bg-white shadow-sm">
                  {isImage ? (
                    <img src={dataUrl} alt={att.name} className="h-16 w-16 object-cover rounded" />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <svg className="h-5 w-5 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <path d="M14 2v6h6"/>
                      </svg>
                      <span className="max-w-[180px] truncate" title={att.name}>{att.name}</span>
                    </div>
                  )}
                  <button type="button" onClick={() => removeAttachment(idx)} className="absolute -top-2 -right-2 bg-white border border-gray-300 rounded-full p-0.5 shadow hover:bg-gray-50">
                    <svg className="h-4 w-4 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <form onSubmit={handleSubmit} className="w-full max-w-5xl mx-auto">
          <div
            className={`flex items-center gap-2 rounded-full border border-gray-300 bg-white shadow-sm px-3 sm:px-4 py-2 ${
              isDragging ? 'ring-2 ring-violet-500 ring-offset-2' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => fileInputBottomRef.current?.click()}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-700"
              title="Attach files"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
            <input
              ref={fileInputBottomRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={handleFileChange}
              className="hidden"
              disabled={isLoading}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={isLoading}
              className="flex-1 min-w-0 bg-transparent border-0 focus:outline-none resize-none text-gray-800 placeholder:text-gray-400"
            />
            <button
              type="submit"
              disabled={(!input.trim() && attachments.length === 0) || isLoading}
              className="p-2.5 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed shadow"
              title="Send"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13"/>
                <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </div>
          <div className="px-2 mt-1 text-[11px] text-gray-400 select-none">Enter = newline • Cmd/Ctrl+Enter = send</div>
        </form>
      </div>
      )}
    </div>
  );
};

export default ChatInterface;
