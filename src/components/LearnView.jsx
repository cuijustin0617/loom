import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { markSaved, markDismissed, markAlreadyKnowIt, prefetchCourseContent } from '../services/learn';
import { generateLearnProposalsSimple } from '../services/learn_simple';
import { loadCourseOutlines, loadCourses, saveCourses, loadGoals, loadPendingCourses, appendLearnLog, saveCourseOutlines, clearAllLearnState, loadPrefetchedCourses, savePrefetchedCourses, isRegrouping as getRegroupingFlag, setRegrouping as setRegroupingFlag, loadLearnModel, saveLearnModel } from '../utils/learnStorage';
import { validateAndRepairState, atomicStartCourse, runMaintenance, setGenerationFlag, isGenerating as isGeneratingCourse } from '../utils/learnStateManager';
import { clearDebugLogs } from '../utils/debugConsole';
import DebugConsole from './DebugConsole';
// Feature flag: gate Developer Console via env
const ENABLE_DEV_CONSOLE = import.meta.env.VITE_ENABLE_DEV_CONSOLE === 'true';
import LearnCourseModal from './LearnCourseModal';
import { regroupAllCompleted } from '../services/learn';

// Learn Mode Model Selector
function LearnModelSelector({ selectedModel, onModelChange }) {
  const models = [
    { id: 'gemini-2.5-flash', name: 'Flash' },
    { id: 'gemini-2.5-flash-lite', name: 'Flash Lite' },
    { id: 'gemini-2.5-pro', name: 'Pro' },
  ];
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const current = models.find(m => m.id === selectedModel) || models[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-gray-200 rounded-full bg-white/70 shadow-sm hover:bg-white focus:outline-none focus:ring-2 focus:ring-violet-600"
      >
        <span className="font-medium text-gray-800">{current.name}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-10 mt-2 w-32 rounded-md border border-gray-200 bg-white shadow-lg">
          <ul className="py-1">
            {models.map(model => (
              <li key={model.id}>
                <button
                  type="button"
                  onClick={() => { onModelChange(model.id); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-violet-600/10 ${
                    selectedModel === model.id ? 'text-violet-600' : 'text-gray-800'
                  }`}
                >
                  <span>{model.name}</span>
                  {selectedModel === model.id && (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
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
}

// Very small markdown renderer for inline card text (links, bold/italic, code)
function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
function renderInlineMarkdown(md) {
  let s = escapeHtml(md);
  // links [text](url)
  s = s.replace(/\[(.+?)\]\((https?:\/\/[^\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>');
  // inline code `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1<\/code>');
  // bold **text**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1<\/strong>');
  // italics *text*
  s = s.replace(/\*(.+?)\*/g, '<em>$1<\/em>');
  // newlines to breaks
  s = s.replace(/\n/g, '<br/>');
  return s;
}

const StatusBadge = ({ status }) => {
  if (!status) return null;
  const map = {
    suggested: 'bg-gray-100 text-gray-700',
    saved: 'bg-blue-100 text-blue-800',
    started: 'bg-emerald-100 text-emerald-800',
    completed: 'bg-emerald-200 text-emerald-900',
    dismissed: 'bg-gray-100 text-gray-500'
  };
  return <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
};

// Tiny module progress stepper for started courses
const ModuleStepper = ({ course }) => {
  if (!course || course.status !== 'started') return null;
  const mods = Array.isArray(course.modules) ? course.modules : [];
  const prog = course.progress_by_module || {};
  const total = mods.length;
  if (total === 0) return null;
  const doneCount = mods.reduce((acc, m) => acc + (prog[m.module_id] === 'done' ? 1 : 0), 0);
  return (
    <div className="flex items-center gap-1" aria-label={`Progress ${doneCount} of ${total} modules complete`}>
      {mods.map((m) => (
        <span key={m.module_id || m.title} className={`inline-block w-1.5 h-1.5 rounded-full ${prog[m.module_id] === 'done' ? 'bg-emerald-600' : 'bg-gray-300'}`} />
      ))}
      <span className="ml-1 text-[11px] text-gray-500">{doneCount}/{total}</span>
    </div>
  );
};

const CourseCard = ({ outline, onStart, onSave, onDismiss, onAlreadyKnow, showGoalTag, kind, onlyPrimaryAndRemove = false }) => {
  const moduleCount = (outline.modules || []).length;
  const totalMinutes = (outline.modules || []).reduce((s, m) => s + (Number(m.est_minutes) || 0), 0);
  const primaryLabel = outline.status === 'started' ? 'Continue' : 'Start';
  const showSave = outline.status === 'suggested';
  const showDismiss = outline.status === 'suggested' || outline.status === 'saved';
  // Visual emphasis: started courses appear distinct from new suggestions
  const tone = outline.status === 'started'
    ? { box: 'border-amber-300', accent: 'border-l-amber-500', bg: 'bg-gradient-to-br from-amber-50/20 to-white' }
    : (kind === 'explore'
        ? { box: 'border-emerald-300', accent: 'border-l-emerald-500', bg: 'bg-gradient-to-br from-emerald-50/1 to-white' }
        : { box: 'border-emerald-200', accent: 'border-l-emerald-400', bg: 'bg-gradient-to-br from-emerald-50/5 to-white' });

  return (
    <div className={`interactive-card h-full flex flex-col border ${tone.box} border-l-4 ${tone.accent} rounded-lg p-4 ${tone.bg} shadow-sm overflow-hidden`}>
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          <div className="text-[15px] md:text-base font-semibold text-gray-900 leading-snug line-clamp-2">{outline.title}</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {showGoalTag && outline.goal && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-emerald-300 text-emerald-800 bg-emerald-50">{outline.goal}</span>
            )}
            {kind && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${kind==='explore' ? 'border-violet-300 text-violet-700 bg-violet-50' : 'border-amber-300 text-amber-800 bg-amber-50'}`}>
                {kind === 'explore' ? 'Explore' : 'Strengthen'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {outline.status === 'started' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${outline.awaitingContent ? 'border-amber-300 text-amber-800 bg-amber-50' : 'border-emerald-300 text-emerald-800 bg-emerald-50'}`}>
              {outline.awaitingContent ? 'Generating…' : 'Ready'}
            </span>
          )}
          <StatusBadge status={outline.status} />
        </div>
      </div>

      {outline.why_suggested && (
        <div className="md-inline text-gray-700 line-clamp-3 mb-2" dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(String(outline.why_suggested || '')) }} />
      )}

      {/* Questions (full, smaller) */}
      {(outline.questions_you_will_answer || []).length > 0 && (
        <ul className="list-disc list-inside text-[12px] text-gray-800 mb-2">
          {(outline.questions_you_will_answer || []).map((q, i) => (
            <li key={i} className="line-clamp-1">{q}</li>
          ))}
        </ul>
      )}

      {/* Module titles preview */}
      {(outline.modules || []).length > 0 && (
        <div className="mb-2">
          <div className="text-[11px] text-gray-500 mb-1">Modules</div>
          <ul className="list-disc list-inside text-[12px] text-gray-800">
            {(outline.modules || []).slice(0, 4).map((m, i) => (
              <li key={i} className="truncate">{m.title}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Meta row */}
      <div className="mb-2 text-[12px] text-gray-600 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="tag tag-soft">{moduleCount > 0 ? `${moduleCount} module${moduleCount>1?'s':''}` : '4 modules'}</span>
          <span className="tag tag-soft">~{totalMinutes || 20}m</span>
        </div>
        <ModuleStepper course={outline} />
      </div>

      <div className="mt-auto flex items-center gap-2 flex-nowrap">
        <button onClick={onStart} className="h-[42px] px-3 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700">{primaryLabel}</button>
        {onlyPrimaryAndRemove ? (
          <button aria-label="Remove" onClick={onDismiss} className="h-[42px] px-3 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Remove</button>
        ) : (
          <>
            {showSave && (
              <button aria-label="Save for later" onClick={onSave} className="h-[42px] px-3 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Save</button>
            )}
            {showDismiss && (
              <button aria-label="Not interested" onClick={onDismiss} className="h-[42px] px-2.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-normal w-28 leading-tight">Not interested</button>
            )}
            <button aria-label="Mark as already known" onClick={onAlreadyKnow} className="h-[42px] px-2.5 text-sm rounded-md border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 whitespace-normal w-28 leading-tight">Already know it</button>
          </>
        )}
      </div>
    </div>
  );
};

export default function LearnView({ conversations, onExitLearn }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [outlines, setOutlines] = useState(() => loadCourseOutlines());
  const [courses, setCourses] = useState(() => loadCourses());
  const [goals, setGoals] = useState(() => loadGoals());
  const [modalOpen, setModalOpen] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugTick, setDebugTick] = useState(0);
  const [activeOutline, setActiveOutline] = useState(null);
  const [regrouping, setRegrouping] = useState(() => getRegroupingFlag());
  const [expandedSections, setExpandedSections] = useState({ suggested: true, completed: true, continue: true });
  const [selectedModel, setSelectedModel] = useState(() => loadLearnModel());
  const [refreshTick, setRefreshTick] = useState(0);

  const handleModelChange = (model) => {
    setSelectedModel(model);
    saveLearnModel(model);
  };

  const continueList = useMemo(() => {
    const startedCourses = courses
      .filter(c => c.status === 'started')
      .map(c => ({ ...c, awaitingContent: false }));
    const startedSet = new Set(startedCourses.map(c => c.course_id));
    
    // Check prefetch cache to see if any started outlines have completed generation
    const prefetchedMap = loadPrefetchedCourses() || {};
    
    const startedOutlines = (outlines || [])
      .filter(o => o.status === 'started' && !startedSet.has(o.course_id))
      .map(o => {
        // If it's in the prefetch cache, it's ready (awaitingContent: false)
        const hasPrefetched = !!prefetchedMap[o.course_id];
        return {
          course_id: o.course_id,
          title: o.title,
          goal: o.goal,
          status: 'started',
          awaitingContent: !hasPrefetched,
          modules: o.modules?.map(m=>({ title: m.title, est_minutes: m.est_minutes })) || [],
          questions_you_will_answer: o.questions_you_will_answer || []
        };
      });
    const savedOutlines = (outlines || []).filter(o => o.status === 'saved').map(o => ({
      course_id: o.course_id,
      title: o.title,
      goal: o.goal,
      status: 'saved',
      modules: o.modules?.map(m=>({ title: m.title, est_minutes: m.est_minutes })) || [],
      questions_you_will_answer: o.questions_you_will_answer || []
    }));
    // Show started courses first, then started outlines awaiting generation, then saved
    return [...startedCourses, ...startedOutlines, ...savedOutlines];
  }, [courses, outlines, refreshTick]);
  const completedList = useMemo(() => courses.filter(c => c.status === 'completed'), [courses]);

  const regenerate = useCallback(async () => {
    setError('');
    setLoading(true);
    clearDebugLogs(); // fresh debug for this run
    if (ENABLE_DEV_CONSOLE) setDebugVisible(true);
    try {
      // Run maintenance first: validation, cleanup, etc.
      runMaintenance();
      
      const { proposals, savedOutlines } = await generateLearnProposalsSimple({ conversations, useExistingSummaries: true });
      const fresh = Array.isArray(savedOutlines) ? savedOutlines : loadCourseOutlines();
      setOutlines(fresh);
      appendLearnLog({ type: 'learn_suggestions_generated', count: proposals?.length || 0 });
      if (!proposals || proposals.length === 0) {
        setError('No suggestions generated. A fallback should have appeared, but returned empty.');
      }
      // Kick off background prefetch for top 3 suggested items
      try {
        const suggestedFresh = (fresh || []).filter(o => o.status === 'suggested');
        const pick = suggestedFresh.slice(0, 3);
        const prefetchedMap = loadPrefetchedCourses() || {};
        const existingCourses = loadCourses() || [];
        const existingIds = new Set(existingCourses.map(c => c.course_id));
        const already = new Set(Object.keys(prefetchedMap || {}));
          for (const o of pick) {
            if (existingIds.has(o.course_id) || already.has(o.course_id) || isGeneratingCourse(o.course_id)) continue;
            setGenerationFlag(o.course_id, true);
            // Fire and forget with proper cleanup
            prefetchCourseContent({ outline: o, conversations })
              .finally(() => setGenerationFlag(o.course_id, false))
              .catch((err) => {
                console.warn(`[LearnView] Prefetch failed for ${o.course_id}:`, err);
                setGenerationFlag(o.course_id, false);
              });
          }
        } catch {}
      } catch (e) {
      setError(e?.message || 'Failed to generate suggestions.');
      try {
        const { appendDebugLog } = await import('../utils/debugConsole');
        appendDebugLog({ scope: 'learn', kind: 'generate_error', error: e?.stack || e?.message || String(e) });
      } catch {}
    } finally {
      setLoading(false);
      setDebugTick(x => x + 1);
    }
  }, [conversations]);

  useEffect(() => {
    // Run maintenance on mount
    runMaintenance();
    
    // Load persisted outlines; only generate if TRULY empty (no outlines at all)
    const current = loadCourseOutlines();
    setOutlines(current);
    
    // Only auto-generate if we have conversations but no outlines at all
    // This prevents regeneration on mode switch
    const hasAnyOutlines = current && current.length > 0;
    const hasConversations = conversations && conversations.length > 0;
    
    if (!hasAnyOutlines && hasConversations) {
      // Only generate once on first real mount
      const hasGenerated = sessionStorage.getItem('loom_learn_initial_generated');
      if (!hasGenerated) {
        sessionStorage.setItem('loom_learn_initial_generated', '1');
        regenerate();
      }
    }
  }, []);

  // Reconcile outlines <-> courses to prevent ghost states
  // Run validation periodically instead of on every change to avoid race conditions
  useEffect(() => {
    // Run once on mount
    try {
      validateAndRepairState();
    } catch (error) {
      console.error('[LearnView] Initial reconciliation failed:', error);
    }
    
    // Then run periodically (every 5 seconds) to catch any drift
    const interval = setInterval(() => {
      try {
        const result = validateAndRepairState();
        
        if (result.repaired) {
          // Refresh state from storage after repairs
          setOutlines(loadCourseOutlines());
          setCourses(loadCourses());
          setGoals(loadGoals());
        }
      } catch (error) {
        console.error('[LearnView] Reconciliation failed:', error);
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, []); // Only run on mount, not on every course change

  // Poll global regrouping flag so the button reflects background regroup
  useEffect(() => {
    const t = window.setInterval(() => {
      try { setRegrouping(getRegroupingFlag()); } catch {}
    }, 400);
    return () => window.clearInterval(t);
  }, []);

  // Poll for background generation completion: check if started outlines now have full courses
  useEffect(() => {
    const t = window.setInterval(() => {
      try {
        const currentOutlines = loadCourseOutlines() || [];
        const currentCourses = loadCourses() || [];
        const courseIds = new Set(currentCourses.map(c => c.course_id));
        
        // Find started outlines without full courses
        const startedAwaitingContent = currentOutlines.filter(
          o => o.status === 'started' && !courseIds.has(o.course_id)
        );
        
        if (startedAwaitingContent.length === 0) return;
        
        // Check if any have completed generation
        let hasNewCourses = false;
        for (const outline of startedAwaitingContent) {
          // Check if course appeared in storage
          const nowExists = currentCourses.some(c => c.course_id === outline.course_id);
          if (nowExists) {
            hasNewCourses = true;
            break;
          }
          
          // Check prefetch cache for completed but not yet moved courses
          const prefetchedMap = loadPrefetchedCourses() || {};
          if (prefetchedMap[outline.course_id]) {
            hasNewCourses = true;
            break;
          }
          
          // Or check if generation flag cleared (might have failed)
          if (!isGeneratingCourse(outline.course_id)) {
            // Generation stopped but no course - might have failed
            // Refresh state to update UI
            hasNewCourses = true;
            break;
          }
        }
        
        // Refresh state if we detected changes
        if (hasNewCourses) {
          // Load fresh data from storage
          const freshCourses = loadCourses();
          const freshOutlines = loadCourseOutlines();
          
          // Update state to trigger re-render
          setCourses(freshCourses);
          setOutlines(freshOutlines);
          
          // Increment refresh tick to force continueList to recompute with latest prefetch cache
          setRefreshTick(t => t + 1);
        }
      } catch (error) {
        console.error('[LearnView] Background generation polling error:', error);
      }
    }, 1000); // Poll every 1 second for faster UI updates
    
    return () => window.clearInterval(t);
  }, [courses, outlines]);

  const handleStart = async (outline) => {
    // If the course is already completed, just open it without changing status
    const existingCourse = (loadCourses() || []).find(c => c.course_id === outline.course_id);
    if (existingCourse && existingCourse.status === 'completed') {
      setActiveOutline(outline);
      setModalOpen(true);
      return;
    }
    
    // Use atomic start course operation
    const result = atomicStartCourse(outline);
    
    if (result.success) {
      // Refresh state to reflect changes
      setOutlines(loadCourseOutlines());
      setCourses(loadCourses());
      setActiveOutline(outline);
      setModalOpen(true);
    } else {
      setError(result.error?.message || 'Failed to start course');
    }
  };

  const handleSave = (outline) => {
    markSaved(outline);
    setOutlines(loadCourseOutlines());
    showToast('Saved for later');
  };

  const handleDismiss = (outline) => {
    markDismissed(outline);
    setOutlines(loadCourseOutlines());
    showToast('Dismissed');
  };

  const handleAlreadyKnow = async (outline) => {
    if (!window.confirm('Mark this course as already known? It will be moved to your completed courses.')) return;
    
    try {
      // Mark as completed via self-report
      await markAlreadyKnowIt(outline);
      
      // Refresh all state
      setOutlines(loadCourseOutlines());
      setCourses(loadCourses());
      setGoals(loadGoals());
      
      // Show success feedback
      showToast('✓ Marked as completed');
    } catch (error) {
      setError(error?.message || 'Failed to mark as known');
    }
  };

  const handleRemoveFromContinue = useCallback((item) => {
    try {
      const currentOutlines = loadCourseOutlines() || [];
      const currentCourses = loadCourses() || [];
      const hasCourseRecord = currentCourses.some(c => c.course_id === item.course_id);
      if (hasCourseRecord) {
        const remaining = currentCourses.filter(c => c.course_id !== item.course_id);
        saveCourses(remaining);
        const updatedOutlines = currentOutlines.map(o => o.course_id === item.course_id ? { ...o, status: 'dismissed' } : o);
        saveCourseOutlines(updatedOutlines);
      } else {
        const updatedOutlines = currentOutlines.map(o => o.course_id === item.course_id ? { ...o, status: 'dismissed' } : o);
        saveCourseOutlines(updatedOutlines);
      }
      // Stop any in-flight generation and clear prefetch cache for this course
      try { setGenerationFlag(item.course_id, false); } catch {}
      try {
        const cache = loadPrefetchedCourses() || {};
        if (cache[item.course_id]) { delete cache[item.course_id]; savePrefetchedCourses(cache); }
      } catch {}
      setCourses(loadCourses());
      setOutlines(loadCourseOutlines());
      showToast('Removed');
    } catch {
      showToast('Failed to remove');
    }
  }, []);

  const existingGoalLabels = useMemo(() => Array.from(new Set((goals || []).map(g => g.label).filter(Boolean))), [goals]);
  const suggested = useMemo(() => (outlines || []).filter(o => o.status === 'suggested'), [outlines]);
  // Flat prioritized list for Learn panel: labeled first, then unlabeled
  const learnList = useMemo(() => {
    const withKnown = [];
    const without = [];
    for (const o of suggested) {
      const hasKnown = Boolean(o.goal && existingGoalLabels.includes(o.goal));
      (hasKnown ? withKnown : without).push(o);
    }
    return [...withKnown, ...without];
  }, [suggested, existingGoalLabels]);
  const saved = useMemo(() => (outlines || []).filter(o => o.status === 'saved'), [outlines]);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg) => {
    setToast({ msg });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 1800);
  }, []);

  // Progress: canonical groups (>=2 completed) and pending singletons
  const groupsFromGoals = useMemo(() => Array.isArray(goals) ? goals.filter(g => Array.isArray(g.completed_courses) && g.completed_courses.length >= 2) : [], [goals]);
  const pendingCompleted = useMemo(() => {
    const ids = new Set(loadPendingCourses() || []);
    return (courses || []).filter(c => c.status === 'completed' && ids.has(c.course_id));
  }, [courses, goals]);

  const goalStats = useMemo(() => {
    // Build stats from canonical groups (completed only)
    const stats = groupsFromGoals.map((g) => {
      const items = (g.completed_courses || []).map(cid => (courses || []).find(c => c.course_id === cid)).filter(Boolean);
      const completed = items.length;
      const score = completed; // rank purely by completed
      const moduleTags = Array.from(new Set(items.flatMap(c => (c.modules || []).map(m => m.title)).filter(Boolean))).slice(0, 6);
      return { label: g.label, items, completed, inProgress: 0, score, moduleTags, startedList: [] };
    });
    // sort by descending score
    return stats.sort((a,b)=> b.score - a.score);
  }, [groupsFromGoals, courses]);
  const maxGoalScore = useMemo(() => {
    const m = Math.max(0, ...goalStats.map(s => s.score));
    return m || 1;
  }, [goalStats]);

  return (
    <div className="flex h-screen w-full bg-white">
      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xl font-semibold text-gray-900">Learn</div>
            <div className="flex items-center gap-2">
              <LearnModelSelector 
                selectedModel={selectedModel} 
                onModelChange={handleModelChange}
              />
              {ENABLE_DEV_CONSOLE && (
                <button onClick={() => setDebugVisible(v => !v)} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">{debugVisible ? 'Hide Debug' : 'Show Debug'}</button>
              )}
              <button
                onClick={() => {
                  if (window.confirm('Restart Learn mode? This will clear all suggestions, progress, and goals, but keep your chat summaries for faster regeneration.')) {
                    // Clear everything except summaries (much faster restart)
                    clearAllLearnState({ keepSummaries: true });
                    setOutlines([]); 
                    setCourses([]); 
                    setGoals([]);
                    // DON'T clear session flag - prevents auto-generation on mount
                    // User will click Refresh when ready
                    showToast('Learn mode restarted. Click Refresh to generate new suggestions.');
                  }
                }}
                className="px-3 py-1.5 text-sm rounded-md border border-red-600 text-red-700 hover:bg-red-50"
              >Restart</button>
            </div>
          </div>
          {error && (
            <div className="mb-3 px-3 py-2 rounded-md border border-red-300 bg-red-50 text-red-800 text-sm">
              {error}
            </div>
          )}
          {ENABLE_DEV_CONSOLE && (
            <DebugConsole visible={debugVisible} refreshToken={debugTick} />
          )}
          
          {/* Show pending count prominently if items exist */}
          {pendingCompleted.length > 0 && (
            <div className="mb-3 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-sm flex items-center justify-between">
              <span>You have {pendingCompleted.length} completed course{pendingCompleted.length > 1 ? 's' : ''} ready to organize into goals.</span>
              <button
                onClick={async () => {
                  setRegrouping(true); setRegroupingFlag(true);
                  try {
                    showToast('Organizing...');
                    const r = await regroupAllCompleted();
                    setCourses(loadCourses()); setGoals(loadGoals()); setOutlines(loadCourseOutlines());
                    if (r && typeof r.regrouped === 'number') {
                      showToast(r.regrouped > 0 ? `✓ Organized ${r.regrouped} item${r.regrouped===1?'':'s'}` : 'Already organized');
                    } else {
                      showToast('✓ Organization complete');
                    }
                  } catch (e) {
                    showToast('Organization failed');
                  } finally { setRegrouping(false); setRegroupingFlag(false); }
                }}
                disabled={regrouping}
                className={`px-3 py-1.5 text-xs rounded-md border border-amber-600 text-amber-900 bg-amber-100 ${regrouping ? 'opacity-60 cursor-not-allowed' : 'hover:bg-amber-200'}`}
              >{regrouping ? 'Organizing...' : 'Organize now'}</button>
            </div>
          )}

          {/* Learn panel (new lessons) */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-emerald-700 mb-2 flex items-center gap-2">
                <span>Learn</span>
                <button onClick={regenerate} disabled={loading} className={`px-2.5 py-1 text-xs rounded-md text-white ${loading ? 'bg-emerald-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'}`}>Refresh</button>
              </div>
              <button className="text-xs text-emerald-700 underline" onClick={() => setExpandedSections(prev => ({...prev, suggested: !prev.suggested}))}>{expandedSections.suggested ? 'Collapse' : 'Expand'}</button>
            </div>
            {!expandedSections.suggested ? null : learnList.length === 0 && !loading ? (
              <div className="text-gray-600">No suggestions yet. Click Refresh to propose mini-courses.</div>
            ) : (
              <div className="space-y-4">
                {loading && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-36" />)}
                  </div>
                )}
                {!loading && (
                  <div className="rounded-xl border border-emerald-200 p-3 bg-gradient-to-br from-emerald-50/10 to-white">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                      {learnList.map((o) => (
                        <CourseCard
                          key={o.course_id}
                          outline={o}
                          kind={o.suggest_kind}
                          showGoalTag={Boolean(o.goal && existingGoalLabels.includes(o.goal))}
                          onStart={() => handleStart(o)}
                          onSave={() => handleSave(o)}
                          onDismiss={() => handleDismiss(o)}
                          onAlreadyKnow={() => handleAlreadyKnow(o)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Continue panel in the middle */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-amber-700 mb-2">Continue</div>
              <button className="text-xs text-emerald-700 underline" onClick={() => setExpandedSections(prev => ({...prev, continue: !prev.continue}))}>{expandedSections.continue ? 'Collapse' : 'Expand'}</button>
            </div>
            {!expandedSections.continue ? null : (
              continueList.length === 0 ? (
                <div className="text-gray-600">No courses in progress.</div>
              ) : (
                <div className="rounded-xl border border-amber-200 p-3 bg-gradient-to-br from-amber-50/15 to-white">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
                  {continueList.map((c) => (
                    <CourseCard
                      key={c.course_id}
                      outline={{
                        ...c,
                        questions_you_will_answer: c.questions_you_will_answer,
                        modules: c.modules,
                        status: c.status
                      }}
                      onStart={() => handleStart(c)}
                      onSave={() => {}}
                      onDismiss={() => handleRemoveFromContinue(c)}
                      onAlreadyKnow={() => {}}
                      onlyPrimaryAndRemove
                    />
                  ))}
                  </div>
                </div>
              )
            )}
          </div>

          


          {/* Progress visualization on bottom with relative bars */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-emerald-700 mb-2 flex items-center gap-3">
                <span>Progress by goal</span>
                <span className="hidden md:inline-flex items-center gap-2 text-xs text-gray-500">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-600" /> Completed
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setRegrouping(true); setRegroupingFlag(true);
                    try {
                      showToast('Regrouping…');
                      const r = await regroupAllCompleted();
                      setCourses(loadCourses()); setGoals(loadGoals()); setOutlines(loadCourseOutlines());
                      if (r && typeof r.regrouped === 'number') {
                        showToast(r.regrouped > 0 ? `Regrouped ${r.regrouped} item${r.regrouped===1?'':'s'}` : 'No regroup changes');
                      } else {
                        showToast('Regroup complete');
                      }
                    } catch (e) {
                      showToast('Regroup failed');
                    } finally { setRegrouping(false); setRegroupingFlag(false); }
                  }}
                  disabled={regrouping}
                  className={`px-2.5 py-1 text-xs rounded-md border border-emerald-600 text-emerald-700 ${regrouping ? 'opacity-60 cursor-not-allowed' : 'hover:bg-emerald-50'}`}
                >{regrouping ? 'Regrouping…' : 'Regroup now'}</button>
                <button className="text-xs text-emerald-700 underline" onClick={() => setExpandedSections(prev => ({...prev, completed: !prev.completed}))}>{expandedSections.completed ? 'Collapse' : 'Expand'}</button>
              </div>
            </div>
            {!expandedSections.completed ? null : goalStats.length === 0 && (pendingCompleted || []).length === 0 ? (
              <div className="text-gray-600">Nothing completed yet.</div>
            ) : (
              <div className="space-y-3">
                {(pendingCompleted || []).length > 0 && (
                  <div className="border border-amber-200 rounded-lg p-3 bg-amber-50/30">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-amber-900">Pending (awaiting regroup)</div>
                      <div className="text-xs text-amber-800">{pendingCompleted.length} lesson{pendingCompleted.length>1?'s':''}</div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {pendingCompleted.slice(0,8).map((c) => (
                        <button key={c.course_id} title={c.title} onClick={() => handleStart(c)} className="chip">
                          <span className="mr-1">•</span>
                          <span className="truncate max-w-[10rem]">{c.title}</span>
                        </button>
                      ))}
                      {pendingCompleted.length > 8 && (
                        <div className="chip"><span className="truncate">+{pendingCompleted.length - 8} more</span></div>
                      )}
                    </div>
                  </div>
                )}
                {goalStats.map((g) => {
                  const basePct = Math.max(8, Math.round((g.score / maxGoalScore) * 70));
                  const donePct = basePct;
                  return (
                    <div key={g.label} className="border border-gray-200 rounded-lg p-3 bg-gradient-to-br from-emerald-50/10 to-white">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-gray-900">{g.label}</div>
                        <div className="text-xs text-gray-600">{g.completed} completed</div>
                      </div>
                      <div className="mt-2 progress-rail">
                        <div className="progress-done" style={{ width: `${donePct}%` }} />
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {g.items.slice(0,4).map((c) => (
                          <button key={c.course_id} title={c.title} onClick={() => handleStart(c)} className="chip chip-check">
                            <span className="mr-1">✓</span>
                            <span className="truncate max-w-[10rem]">{c.title}</span>
                          </button>
                        ))}
                        {g.items.length > 4 && (
                          <div className="chip"><span className="truncate">+{g.items.length - 4} more</span></div>
                        )}
                      </div>
                      {g.moduleTags.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          {g.moduleTags.map((t, i) => (
                            <span key={i} className="tag tag-soft">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {toast && (
          <div aria-live="polite" className="fixed bottom-4 right-4 z-50">
            <div className="px-3 py-2 rounded-md shadow bg-emerald-600 text-white text-sm">{toast.msg}</div>
          </div>
        )}
      </div>

      {/* Course Modal */}
      <LearnCourseModal
        open={modalOpen}
        outline={activeOutline}
        conversations={conversations}
        onClose={() => {
          setModalOpen(false);
          setActiveOutline(null);
          // Force immediate state refresh when modal closes
          // This ensures "Generating..." badges update to "Ready" if generation completed in background
          const freshCourses = loadCourses();
          const freshOutlines = loadCourseOutlines();
          const freshGoals = loadGoals();
          
          setCourses(freshCourses);
          setGoals(freshGoals);
          
          // Always update outlines, even if empty (user might have dismissed all)
          if (Array.isArray(freshOutlines)) {
            setOutlines(freshOutlines);
          }
          
          // Force a re-render by triggering the polling check immediately and incrementing refresh tick
          setRefreshTick(t => t + 1);
          setTimeout(() => {
            setCourses(loadCourses());
            setOutlines(loadCourseOutlines());
            setRefreshTick(t => t + 1);
          }, 100);
        }}
        onUpdateCourses={(list) => { setCourses(list); setGoals(loadGoals()); setOutlines(loadCourseOutlines()); }}
      />
    </div>
  );
}
