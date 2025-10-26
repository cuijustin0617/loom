import { useEffect, useMemo, useState } from 'react';
import { generateFullCourse, setModuleProgress, prefetchCourseContent } from '../services/learn';
import { loadCourses, saveCourses, loadPrefetchedCourses, savePrefetchedCourses, loadCourseOutlines, saveCourseOutlines, loadPendingCourses, savePendingCourses } from '../utils/learnStorage';
import { updateCourseStatus, setGenerationFlag, isGenerating as isGeneratingCourse } from '../utils/learnStateManager';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

function ModuleQuiz({ module, courseId, onDone }) {
  const items = Array.isArray(module?.quiz) ? module.quiz : [];
  const [answers, setAnswers] = useState(() => items.map(() => -1));
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(() => items.map(() => false));

  const allSelected = answers.every(i => i >= 0);
  const allCorrect = submitted && result.every(Boolean);

  const handleSelect = (qi, ci) => {
    setAnswers(prev => prev.map((v, i) => i === qi ? ci : v));
  };
  const handleSubmit = () => {
    const r = items.map((q, i) => Number(answers[i]) === Number(q?.answer_index || 0));
    setResult(r);
    setSubmitted(true);
  };
  const handleRetry = () => {
    setSubmitted(false);
  };

  return (
    <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
      <div className="text-sm font-medium text-emerald-900 mb-2">Quick quiz</div>
      <div className="space-y-3">
        {items.map((q, qi) => (
          <div key={qi} className="p-2 rounded-md bg-white/60 border border-emerald-100">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm text-emerald-900">{q?.prompt || `Question ${qi+1}`}</div>
              {submitted && (
                <span className={`text-xs ${result[qi] ? 'text-emerald-700' : 'text-amber-700'}`}>{result[qi] ? '✓ Correct' : '✕ Try again'}</span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              {(Array.isArray(q?.choices) ? q.choices : []).map((c, ci) => {
                const selected = answers[qi] === ci;
                return (
                  <button
                    key={ci}
                    type="button"
                    onClick={() => handleSelect(qi, ci)}
                    className={`w-full text-left px-3 py-2 rounded-md border ${selected ? 'border-emerald-600 bg-emerald-50' : 'border-emerald-100 bg-white hover:bg-emerald-50/50'} text-sm`}
                  >
                    <span className={`inline-block w-4 h-4 mr-2 align-middle rounded-full border ${selected ? 'bg-emerald-600 border-emerald-600' : 'border-emerald-400'}`} />
                    <span className="align-middle">{c}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {!submitted ? (
          <button disabled={!allSelected} onClick={handleSubmit} className={`px-3 py-1.5 text-sm rounded-md ${allSelected ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-emerald-300 text-white cursor-not-allowed'}`}>Submit answers</button>
        ) : allCorrect ? (
          <>
            <span className="text-sm text-emerald-800">Great job — all correct.</span>
            <button
              onClick={onDone}
              className="ml-auto px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-md"
            >
              Mark as done
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-amber-800">Some answers need a tweak.</span>
            <button onClick={handleRetry} className="px-3 py-1.5 text-sm rounded-md border border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-50">Retry</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function LearnCourseModal({ open, outline, conversations, onClose, onUpdateCourses }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [course, setCourse] = useState(null);
  const [activeModuleId, setActiveModuleId] = useState(null);
  const [generationFailed, setGenerationFailed] = useState(false);
  const completeAndClose = () => {
    try {
      if (course && course.status === 'completed') {
        const pending = new Set(loadPendingCourses() || []);
        if (!pending.has(course.course_id)) {
          pending.add(course.course_id);
          savePendingCourses(Array.from(pending));
        }
      }
    } catch {}
    onClose();
  };
  const pickNextIncompleteModuleId = (c) => {
    const list = Array.isArray(c?.modules) ? c.modules : [];
    const pbm = c?.progress_by_module || {};
    const next = list.find(m => pbm[m.module_id] !== 'done');
    return next?.module_id || list[0]?.module_id || null;
  };

  const activeModule = useMemo(() => {
    if (!course) return null;
    const list = Array.isArray(course.modules) ? course.modules : [];
    return list.find(m => m.module_id === activeModuleId) || list[0];
  }, [course, activeModuleId]);

  useEffect(() => {
    if (!open || !outline) return;
    let cancelled = false;
    setError('');
    setLoading(true);
    setGenerationFailed(false);
    const cid = outline.course_id;
    const finish = () => { if (!cancelled) setLoading(false); };
    
    // 1) Check existing full course
    const existing = (loadCourses() || []).find(c => c.course_id === cid);
    if (existing) {
      if (!cancelled) {
        setCourse(existing);
        setActiveModuleId(pickNextIncompleteModuleId(existing));
      }
      finish();
      return () => { cancelled = true; };
    }
    // 2) Check prefetched content; if present, adopt into real courses via generateFullCourse-equivalent save
    const prefetchedMap = loadPrefetchedCourses() || {};
    const prefetched = prefetchedMap[cid];
    if (prefetched) {
      // Adopt: persist as started via setModuleProgress or by saving through generateFullCourse path
      // Simplest: persist using existing data shape and flow by creating the course record directly
      try {
        // Create as started course
        const duck = { ...prefetched, status: 'started' };
        const courses = loadCourses() || [];
        saveCourses([duck, ...courses.filter(c => c.course_id !== cid)]);
        // Only flip outline if course persisted successfully
        const ok = (loadCourses() || []).some(c => c.course_id === cid && c.status === 'started');
        try {
          if (ok) {
            const outlines = loadCourseOutlines() || [];
            const updated = outlines.map(o => o.course_id === cid ? { ...o, status: 'started' } : o);
            saveCourseOutlines(updated);
          }
        } catch {}
        // remove from prefetch cache only if persisted OK
        if (ok) {
          delete prefetchedMap[cid];
          savePrefetchedCourses(prefetchedMap);
        }
        if (!cancelled) {
          setCourse(duck);
          setActiveModuleId(pickNextIncompleteModuleId(duck));
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load prefetched content.');
      } finally {
        finish();
      }
      return () => { cancelled = true; };
    }
    // 3) If auto-generation is in progress, poll for completion; else generate now
    if (isGeneratingCourse(cid)) {
      let tries = 0;
      const poll = async () => {
        if (cancelled) return;
        // If the full course has been saved already, adopt it immediately
        const saved = (loadCourses() || []).find(c => c.course_id === cid);
        if (saved) {
          try {
            try {
              const outlines = loadCourseOutlines() || [];
              const updated = outlines.map(o => o.course_id === cid ? { ...o, status: 'started' } : o);
              saveCourseOutlines(updated);
            } catch {}
            setGenerationFlag(cid, false);
            if (!cancelled) {
              setCourse(saved);
              setActiveModuleId(pickNextIncompleteModuleId(saved));
            }
          } finally {
            finish();
          }
          return;
        }
        const map = loadPrefetchedCourses() || {};
        const ready = map[cid];
        if (ready) {
          try {
            const duck = { ...ready, status: 'started' };
            const courses = loadCourses() || [];
            saveCourses([duck, ...courses.filter(c => c.course_id !== cid)]);
            // Only flip outline if course persisted successfully
            const ok = (loadCourses() || []).some(c => c.course_id === cid && c.status === 'started');
            try {
              if (ok) {
                const outlines = loadCourseOutlines() || [];
                const updated = outlines.map(o => o.course_id === cid ? { ...o, status: 'started' } : o);
                saveCourseOutlines(updated);
              }
            } catch {}
            if (ok) {
              delete map[cid];
              savePrefetchedCourses(map);
            }
            setGenerationFlag(cid, false);
            if (!cancelled) {
              setCourse(duck);
              setActiveModuleId(pickNextIncompleteModuleId(duck));
            }
          } finally {
            finish();
          }
        } else if (tries < 80) { // ~20s at 250ms
          tries++;
          setTimeout(poll, 250);
        } else {
          // Timeout: fall back to on-demand generation, but re-check for a saved course first
          try {
            const savedLate = (loadCourses() || []).find(c => c.course_id === cid);
            if (savedLate) {
              setGenerationFlag(cid, false);
              if (!cancelled) {
                setCourse(savedLate);
                setActiveModuleId(pickNextIncompleteModuleId(savedLate));
              }
              finish();
              return;
            }
            setGenerationFlag(cid, true);
            const full = await generateFullCourse({ outline, conversations, avoidOutlines: [] });
            if (!cancelled) {
              setCourse(full);
              setActiveModuleId(pickNextIncompleteModuleId(full));
            }
          } catch (e) {
            if (!cancelled) {
              setError(e.message || 'Generation failed.');
              setGenerationFailed(true);
              // IMPORTANT: Keep in started state - don't rollback
              // This ensures the course stays visible in Continue section
            }
          } finally {
            setGenerationFlag(cid, false);
            finish();
          }
        }
      };
      poll();
      return () => { cancelled = true; };
    }
    // Not generating: generate now (double-check saved before generating)
    // IMPORTANT: Don't store the generation promise - let it continue even if modal closes
    (async () => {
      try {
        const savedEarly = (loadCourses() || []).find(c => c.course_id === cid);
        if (savedEarly) {
          if (!cancelled) {
            setCourse(savedEarly);
            setActiveModuleId(pickNextIncompleteModuleId(savedEarly));
          }
          finish();
          return;
        }
        setGenerationFlag(cid, true);
        
        // Start generation - this will persist to localStorage regardless of modal state
        const full = await generateFullCourse({ outline, conversations, avoidOutlines: [] });
        
        // Only update React state if modal is still open
        if (!cancelled) {
          setCourse(full);
          setActiveModuleId(pickNextIncompleteModuleId(full));
        }
        // Note: generation completed and persisted to localStorage even if modal closed
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Generation failed.');
          setGenerationFailed(true);
          // IMPORTANT: Keep in started state - don't rollback
          // This ensures the course stays visible in Continue section
        }
        // If modal closed, error is silent but generation flag is cleared
      } finally {
        setGenerationFlag(cid, false);
        if (!cancelled) finish();
      }
    })();
    
    // When modal closes, mark as cancelled but don't stop the generation
    return () => { 
      cancelled = true;
      // Generation continues in background even after modal closes
    };
  }, [open, outline, conversations]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white w-full max-w-5xl max-h-[85vh] rounded-xl shadow-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-semibold text-gray-900">{outline?.title || 'Mini-course'}</div>
          <button onClick={completeAndClose} className="text-gray-600 hover:text-gray-900">✕</button>
        </div>
        {loading ? (
          <div className="p-6 text-gray-600">Generating course…</div>
        ) : error ? (
          <div className="p-6">
            <div className="text-red-600 mb-3">{error}</div>
            <div className="flex items-center gap-2">
              {generationFailed && (
                <button 
                  onClick={() => {
                    setError('');
                    setGenerationFailed(false);
                    setLoading(true);
                    // Retry generation
                    (async () => {
                      try {
                        setGenerationFlag(outline.course_id, true);
                        const full = await generateFullCourse({ outline, conversations, avoidOutlines: [] });
                        setCourse(full);
                        setActiveModuleId(pickNextIncompleteModuleId(full));
                      } catch (e) {
                        setError(e.message || 'Generation failed again.');
                        setGenerationFailed(true);
                        // Keep in started state - don't rollback
                      } finally {
                        setGenerationFlag(outline.course_id, false);
                        setLoading(false);
                      }
                    })();
                  }}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
                >
                  Retry
                </button>
              )}
              <button onClick={() => onClose()} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50">Close</button>
            </div>
          </div>
        ) : course ? (
          <div className="flex-1 flex min-h-0">
            {/* Left: module list */}
            <div className="w-64 shrink-0 border-r p-3 overflow-y-auto">
              <div className="text-xs text-gray-500 mb-2">Questions you will answer</div>
              <ul className="mb-4 list-disc list-inside text-sm text-gray-800">
                {(course.questions_you_will_answer || []).map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
              <div className="text-xs text-gray-500 mb-2">Modules</div>
              <div className="space-y-2">
                {(course.modules || []).map((m) => {
                  const status = course.progress_by_module?.[m.module_id] || 'not_started';
                  const isActive = activeModule?.module_id === m.module_id;
                  return (
                    <button key={m.module_id} onClick={() => setActiveModuleId(m.module_id)} className={`w-full text-left px-3 py-2 rounded-md border ${isActive ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-gray-900">{m.title}</div>
                        <span className="text-[11px] text-gray-600">{m.est_minutes}m</span>
                      </div>
                      <div className="text-xs text-gray-500 capitalize">{status.replace('_',' ')}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: module content */}
            <div className="flex-1 min-w-0 overflow-y-auto p-5">
              {course?.status === 'completed' && (
                <div className="mb-4 p-3 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 flex items-center gap-3">
                  <span className="text-sm font-medium">Course completed</span>
                  <span className="text-emerald-700">✓</span>
                  <button onClick={completeAndClose} className="ml-auto px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700">Completed course</button>
                </div>
              )}
              {activeModule && (
                <div className="prose max-w-none">
                  <h2 className="mt-0">{activeModule.title}</h2>
                  {activeModule.lesson && (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {String(activeModule.lesson || '')}
                      </ReactMarkdown>
                    </div>
                  )}
                  {Array.isArray(activeModule.quiz) && activeModule.quiz.length > 0 ? (
                    <ModuleQuiz
                      key={activeModule.module_id}
                      module={activeModule}
                      courseId={course.course_id}
                      onDone={async () => {
                        await setModuleProgress(course.course_id, activeModule.module_id, 'done');
                        const updated = (loadCourses() || []).find(c => c.course_id === course.course_id);
                        if (updated) {
                          setCourse(updated);
                        } else {
                          // Fallback local state update to reflect progress immediately
                          setCourse(prev => {
                            if (!prev) return prev;
                            const pbm = { ...(prev.progress_by_module || {}), [activeModule.module_id]: 'done' };
                            const vals = Object.values(pbm);
                            const allDone = vals.length > 0 && vals.every(v => v === 'done');
                            return { ...prev, progress_by_module: pbm, status: allDone ? 'completed' : 'started' };
                          });
                          // Best-effort persist if the course record wasn't found
                          try {
                            const pbm = { ...(course?.progress_by_module || {}), [activeModule.module_id]: 'done' };
                            const vals = Object.values(pbm);
                            const allDone = vals.length > 0 && vals.every(v => v === 'done');
                            const localUpdated = { ...course, progress_by_module: pbm, status: allDone ? 'completed' : 'started' };
                            const list = loadCourses() || [];
                            const merged = [localUpdated, ...list.filter(c => c.course_id !== course.course_id)];
                            saveCourses(merged);
                          } catch {}
                        }
                        if (typeof onUpdateCourses === 'function') {
                          try { onUpdateCourses(loadCourses() || []); } catch {}
                        }
                      }}
                    />
                  ) : (
                    activeModule.micro_task && (
                      <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                        <div className="text-sm font-medium text-emerald-900 mb-1">Micro-task</div>
                        <div className="text-sm text-emerald-900 whitespace-pre-wrap">{activeModule.micro_task}</div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                          onClick={async () => {
                            await setModuleProgress(course.course_id, activeModule.module_id, 'done');
                            const updated = (loadCourses() || []).find(c => c.course_id === course.course_id);
                            if (updated) {
                              setCourse(updated);
                            } else {
                              setCourse(prev => {
                                if (!prev) return prev;
                                const pbm = { ...(prev.progress_by_module || {}), [activeModule.module_id]: 'done' };
                                const vals = Object.values(pbm);
                                const allDone = vals.length > 0 && vals.every(v => v === 'done');
                                return { ...prev, progress_by_module: pbm, status: allDone ? 'completed' : 'started' };
                              });
                              // Best-effort persist if the course record wasn't found
                              try {
                                const pbm = { ...(course?.progress_by_module || {}), [activeModule.module_id]: 'done' };
                                const vals = Object.values(pbm);
                                const allDone = vals.length > 0 && vals.every(v => v === 'done');
                                const localUpdated = { ...course, progress_by_module: pbm, status: allDone ? 'completed' : 'started' };
                                const list = loadCourses() || [];
                                const merged = [localUpdated, ...list.filter(c => c.course_id !== course.course_id)];
                                saveCourses(merged);
                              } catch {}
                            }
                            if (typeof onUpdateCourses === 'function') {
                              try { onUpdateCourses(loadCourses() || []); } catch {}
                            }
                          }}
                            className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-md"
                          >
                            Mark as done
                          </button>
                        </div>
                      </div>
                    )
                  )}
                  {course.where_to_go_next && (
                    <div className="mt-8 p-3 bg-gray-50 border border-gray-200 rounded-md">
                      <div className="text-sm font-medium text-gray-900 mb-1">Where to go next</div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">{course.where_to_go_next}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-6 text-gray-600">No course loaded.</div>
        )}
      </div>
    </div>
  );
}
