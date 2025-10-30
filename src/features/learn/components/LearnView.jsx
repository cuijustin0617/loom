/**
 * LearnView - Main Learn Mode Container
 * 
 * Shows suggested courses, in-progress courses, and completed courses with pagination.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useLearnStore } from '../store/learnStore';
import { useSettingsStore } from '../../../shared/store/settingsStore';
import { useLearnOperations } from '../hooks/useLearnOperations';
import ProgressTimer from '../../../shared/components/ProgressTimer';
import db from '../../../lib/db/database';

// Lazy import heavy components
import { lazy, Suspense } from 'react';
const CourseCard = lazy(() => import('./CourseCard'));
const LearnCourseModal = lazy(() => import('./LearnCourseModal'));

const ITEMS_PER_PAGE = 10;

function LearnView() {
  const [activeCourseId, setActiveCourseId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState({
    suggested: 0,
    continue: 0
  });
  const [expandedSections, setExpandedSections] = useState({
    suggested: true,
    continue: true,
    goals: true
  });
  
  const learnModel = useSettingsStore(state => state.learnModel);
  const setLearnModel = useSettingsStore(state => state.setLearnModel);
  
  // Subscribe to actual state, not getter functions!
  const outlines = useLearnStore(state => state.outlines);
  const courses = useLearnStore(state => state.courses);
  const goals = useLearnStore(state => state.goals);
  const getCourseWithModules = useLearnStore(state => state.getCourseWithModules);
  const isAutoRefreshing = useLearnStore(state => state.isAutoRefreshing);
  const isAutoRegrouping = useLearnStore(state => state.isAutoRegrouping);
  const loadLearnData = useLearnStore(state => state.loadLearnData);
  
  const {
    handleStartCourse,
    handleSaveOutline,
    handleDismissOutline,
    handleAlreadyKnow,
    handleRegroup,
    handleRefreshSuggestions,
    isLoadingSuggestions,
    isStartingCourse,
    isRegrouping
  } = useLearnOperations();
  
  // Auto-recovery: Check if store is empty but data exists in IndexedDB
  // This handles cases where HMR resets the store unexpectedly
  const hasCheckedRecovery = useRef(false);
  useEffect(() => {
    async function checkAndRecover() {
      // Only check once per mount
      if (hasCheckedRecovery.current) return;
      hasCheckedRecovery.current = true;
      
      // Check if store is empty
      const storeEmpty = Object.keys(courses).length === 0 && 
                        Object.keys(outlines).length === 0 && 
                        Object.keys(goals).length === 0;
      
      if (!storeEmpty) {
        console.log('[LearnView] Store has data, no recovery needed');
        return;
      }
      
      // Check if IndexedDB has data
      try {
        const [dbCourses, dbOutlines, dbGoals] = await Promise.all([
          db.courses.count(),
          db.outlines.count(),
          db.goals.count()
        ]);
        
        const hasData = dbCourses > 0 || dbOutlines > 0 || dbGoals > 0;
        
        if (hasData) {
          console.log('[LearnView] Store empty but IndexedDB has data - recovering...', {
            courses: dbCourses,
            outlines: dbOutlines,
            goals: dbGoals
          });
          await loadLearnData();
          console.log('[LearnView] Recovery complete');
        } else {
          console.log('[LearnView] No data in store or IndexedDB - fresh start');
        }
      } catch (error) {
        console.error('[LearnView] Recovery check failed:', error);
      }
    }
    
    checkAndRecover();
  }, [courses, outlines, goals, loadLearnData]);
  
  // Compute derived data from state
  const suggested = useMemo(() => {
    console.log('[LearnView] Computing suggested outlines from:', Object.keys(outlines).length, 'outlines');
    const result = Object.values(outlines)
      .filter(o => o.status === 'suggested')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 9); // Max 9 most recent suggested outlines
    console.log('[LearnView] Suggested outlines:', result.length, result);
    return result;
  }, [outlines]);
  
  const started = useMemo(() => {
    const result = Object.values(courses)
      .filter(c => c.status === 'started')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    console.log('[LearnView] Started courses:', result.length);
    return result;
  }, [courses]);
  
  const completed = useMemo(() => {
    const result = Object.values(courses)
      .filter(c => c.status === 'completed')
      .sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
    console.log('[LearnView] Completed courses:', result.length);
    return result;
  }, [courses]);
  
  const goalsWithStats = useMemo(() => {
    const result = Object.values(goals).map(goal => {
      const goalCourses = Object.values(courses).filter(c => c.goal === goal.label);
      const completedCourses = goalCourses.filter(c => c.status === 'completed');
      const startedCount = goalCourses.filter(c => c.status === 'started').length;
      return { 
        ...goal, 
        completedCount: completedCourses.length, 
        startedCount,
        completedCourses
      };
    }).sort((a, b) => {
      // Sort by total course count (completed + started) in descending order
      const totalA = a.completedCount + a.startedCount;
      const totalB = b.completedCount + b.startedCount;
      return totalB - totalA;
    });
    console.log('[LearnView] Goals (sorted by progress):', result);
    return result;
  }, [goals, courses]);
  
  // Completed courses without a goal (pending for grouping)
  const pendingCourses = useMemo(() => {
    return completed.filter(c => !c.goal || c.goal.trim() === '');
  }, [completed]);
  
  // Calculate opacity for each goal based on course count
  const getGoalOpacity = useMemo(() => {
    if (goalsWithStats.length === 0) return () => 1;
    
    // Find max course count
    const maxCourseCount = Math.max(...goalsWithStats.map(g => g.completedCount + g.startedCount));
    
    // Return function to calculate opacity (40% to 100% range)
    return (completedCount, startedCount) => {
      if (maxCourseCount === 0) return 1;
      const totalCount = completedCount + startedCount;
      const normalized = totalCount / maxCourseCount;
      return 0.26 + (normalized * 0.74); // 26% to 100%
    };
  }, [goalsWithStats]);
  
  // Pagination (no pagination for suggested - always max 9 items)
  const paginatedSuggested = suggested; // No pagination needed, max 9 items
  const paginatedContinue = started.slice(
    currentPage.continue * ITEMS_PER_PAGE,
    (currentPage.continue + 1) * ITEMS_PER_PAGE
  );
  
  const totalPages = {
    suggested: 0, // No pagination for suggested
    continue: Math.ceil(started.length / ITEMS_PER_PAGE)
  };
  
  // Handlers
  const handleStartClick = async (item) => {
    try {
      console.log('[LearnView] Starting course:', item.id, 'courseId:', item.courseId);
      
      // Open modal IMMEDIATELY for responsive UX
      setActiveCourseId(item.courseId);
      setModalOpen(true);
      console.log('[LearnView] Modal opened immediately');
      
      // Start course generation in background (this will set generating state)
      const result = await handleStartCourse(item.id);
      console.log('[LearnView] Start course result:', result);
    } catch (error) {
      console.error('[LearnView] Start course error:', error);
      // Keep modal open with error state visible to user
    }
  };
  
  const handleRetryGeneration = async (courseId) => {
    try {
      console.log('[LearnView] Retrying generation for course:', courseId);
      
      // Find the outline for this course
      const outline = Object.values(outlines).find(o => o.courseId === courseId);
      if (!outline) {
        console.error('[LearnView] Outline not found for retry:', courseId);
        return;
      }
      
      // Retry generation
      await handleStartCourse(outline.id);
    } catch (error) {
      console.error('[LearnView] Retry failed:', error);
    }
  };
  
  const handleSave = async (item) => {
    try {
      await handleSaveOutline(item.id);
    } catch (error) {
      console.error('[LearnView] Save failed:', error);
    }
  };
  
  const handleDismiss = async (item) => {
    try {
      await handleDismissOutline(item.id);
    } catch (error) {
      console.error('[LearnView] Dismiss failed:', error);
    }
  };
  
  const handleAlreadyKnowClick = async (item) => {
    if (!window.confirm('Mark this course as already known?')) return;
    
    try {
      await handleAlreadyKnow(item.id);
    } catch (error) {
      alert(`Failed: ${error.message}`);
    }
  };
  
  const PaginationControls = ({ section, total }) => {
    if (total <= 1) return null;
    
    const current = currentPage[section];
    
    return (
      <div className="flex items-center justify-center gap-2 mt-4">
        <button
          onClick={() => setCurrentPage(prev => ({ ...prev, [section]: Math.max(0, current - 1) }))}
          disabled={current === 0}
          className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Previous
        </button>
        <span className="text-sm text-gray-600">
          Page {current + 1} of {total}
        </span>
        <button
          onClick={() => setCurrentPage(prev => ({ ...prev, [section]: Math.min(total - 1, current + 1) }))}
          disabled={current >= total - 1}
          className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Next
        </button>
      </div>
    );
  };
  
  return (
    <div className="flex h-full w-full bg-white">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-xl font-semibold text-gray-900">Learn</div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-600 hidden sm:block">
                Model:
              </div>
              <div className="relative group">
                <select
                  value={learnModel}
                  onChange={(e) => setLearnModel(e.target.value)}
                  className="px-4 py-2 text-sm font-medium border-2 border-emerald-300 rounded-lg bg-white shadow-md hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all cursor-pointer appearance-none pr-10"
                >
                  <option value="gemini-2.5-flash-lite">Flash Lite (fastest)</option>
                  <option value="gemini-2.5-flash">Flash (balanced)</option>
                  <option value="gemini-2.5-pro">Pro (best quality)</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                
                {/* Tooltip */}
                <div className="absolute top-full right-0 mt-2 w-72 p-4 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                  <div className="space-y-3">
                    <div>
                      <div className="font-semibold text-emerald-300 mb-1">Flash Lite</div>
                      <div className="text-gray-300">Fastest generation (~10s) • Good for quick learning • May be less detailed</div>
                    </div>
                    <div>
                      <div className="font-semibold text-emerald-400 mb-1">Flash (Recommended)</div>
                      <div className="text-gray-300">Balanced speed (~30s) • Great quality • Best for most users</div>
                    </div>
                    <div>
                      <div className="font-semibold text-emerald-500 mb-1">Pro</div>
                      <div className="text-gray-300">Highest quality (~50s) • Most comprehensive • Best for deep learning</div>
                    </div>
                  </div>
                  <div className="absolute -top-1 right-6 w-2 h-2 bg-gray-900 transform rotate-45"></div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Continue Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-amber-700">Continue</div>
              <button
                className="text-xs text-emerald-700 underline"
                onClick={() => setExpandedSections(prev => ({ ...prev, continue: !prev.continue }))}
              >
                {expandedSections.continue ? 'Collapse' : 'Expand'}
              </button>
            </div>
            
            {expandedSections.continue && (
              <>
                {paginatedContinue.length === 0 ? (
                  <div className="text-gray-600 text-sm">No courses in progress.</div>
                ) : (
                  <Suspense fallback={<div>Loading...</div>}>
                    <div className="rounded-xl border border-amber-200 p-3 bg-gradient-to-br from-amber-50/15 to-white">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {paginatedContinue.map(course => {
                          // Find the corresponding outline to check if it needs generation
                          const outline = Object.values(outlines).find(o => o.courseId === course.id);
                          const needsGeneration = course.moduleIds.length === 0;
                          
                          return (
                          <CourseCard
                            key={course.id}
                            outline={course}
                            onStart={async () => {
                              // Open modal immediately
                              setActiveCourseId(course.id);
                              setModalOpen(true);
                              
                              // If course needs generation, trigger it
                              if (needsGeneration && outline) {
                                console.log('[LearnView] Continue course needs generation, starting:', course.id);
                                try {
                                  await handleStartCourse(outline.id);
                                } catch (error) {
                                  console.error('[LearnView] Failed to generate course:', error);
                                }
                              }
                            }}
                            onSave={() => {}}
                            onDismiss={() => handleDismiss(course)}
                            onAlreadyKnow={() => {}}
                            onlyPrimaryAndRemove
                          />
                          );
                        })}
                      </div>
                    </div>
                    <PaginationControls section="continue" total={totalPages.continue} />
                  </Suspense>
                )}
              </>
            )}
          </div>
          
          {/* Suggested Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-emerald-700 flex items-center gap-2">
                <span>Suggested</span>
                {isAutoRefreshing && (
                  <span className="px-2.5 py-1 text-xs rounded-md bg-emerald-100 text-emerald-700 border border-emerald-300">
                    Auto-generating...
                  </span>
                )}
                <button
                  onClick={handleRefreshSuggestions}
                  disabled={isLoadingSuggestions || isAutoRefreshing}
                  className={`px-2.5 py-1 text-xs rounded-md text-white ${
                    isLoadingSuggestions || isAutoRefreshing
                      ? 'bg-emerald-400 cursor-not-allowed' 
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isLoadingSuggestions || isAutoRefreshing ? 'Generating...' : 'Refresh'}
                </button>
              </div>
              <button
                className="text-xs text-emerald-700 underline"
                onClick={() => setExpandedSections(prev => ({ ...prev, suggested: !prev.suggested }))}
              >
                {expandedSections.suggested ? 'Collapse' : 'Expand'}
              </button>
            </div>
            
            {expandedSections.suggested && (
              <>
                {paginatedSuggested.length === 0 && !isLoadingSuggestions && !isAutoRefreshing ? (
                  <div className="text-gray-600 text-sm">No suggestions yet. Click Refresh to generate.</div>
                ) : isLoadingSuggestions || isAutoRefreshing ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-6">
                    <ProgressTimer 
                      model={learnModel} 
                      isComplete={!isLoadingSuggestions && !isAutoRefreshing}
                      size={140}
                      color="emerald"
                    />
                    <div className="text-center">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        Generating Course Suggestions...
                      </h3>
                      <p className="text-sm text-gray-600">
                        Analyzing your conversations to find learning opportunities
                      </p>
                    </div>
                  </div>
                ) : (
                  <Suspense fallback={<div>Loading...</div>}>
                    <div className="max-h-[420px] overflow-y-auto rounded-xl border border-emerald-200 p-3 bg-gradient-to-br from-emerald-50/10 to-white">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {paginatedSuggested.map(outline => (
                          <CourseCard
                            key={outline.id}
                            outline={outline}
                            kind={outline.suggestKind || outline.suggest_kind}
                            onStart={() => handleStartClick(outline)}
                            onSave={() => handleSave(outline)}
                            onDismiss={() => handleDismiss(outline)}
                            onAlreadyKnow={() => handleAlreadyKnowClick(outline)}
                          />
                        ))}
                      </div>
                    </div>
                    {/* No pagination for suggested - always max 9 items, scrollable view */}
                  </Suspense>
                )}
              </>
            )}
          </div>
          
          {/* Progress by Goal Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-emerald-700 flex items-center gap-2">
                <span>Progress by Goal</span>
                {isAutoRegrouping && (
                  <span className="px-2.5 py-1 text-xs rounded-md bg-emerald-100 text-emerald-700 border border-emerald-300">
                    Auto-regrouping...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRegroup}
                  disabled={isRegrouping || isAutoRegrouping}
                  className={`px-2.5 py-1 text-xs rounded-md border border-emerald-600 text-emerald-700 ${
                    isRegrouping || isAutoRegrouping ? 'opacity-60 cursor-not-allowed' : 'hover:bg-emerald-50'
                  }`}
                >
                  {isRegrouping || isAutoRegrouping ? 'Regrouping...' : 'Regroup'}
                </button>
                <button
                  className="text-xs text-emerald-700 underline"
                  onClick={() => setExpandedSections(prev => ({ ...prev, goals: !prev.goals }))}
                >
                  {expandedSections.goals ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>
            
            {expandedSections.goals && (
              <>
                {goalsWithStats.length === 0 && pendingCourses.length === 0 ? (
                  <div className="text-gray-600 text-sm">No goals yet. Complete courses to see progress.</div>
                ) : (
                  <div className="space-y-3">
                    {/* Goals with completed courses */}
                    {goalsWithStats.map(goal => {
                      const opacity = getGoalOpacity(goal.completedCount, goal.startedCount);
                      
                      return (
                      <div 
                        key={goal.id} 
                        className="relative group rounded-xl p-5 bg-gradient-to-br from-slate-50 via-white to-slate-50/50 border border-slate-200/60 hover:border-emerald-300/60 transition-all duration-300 shadow-sm hover:shadow-md"
                        style={{ opacity }}
                      >
                        {/* Top accent line */}
                        <div 
                          className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600 rounded-t-xl transition-all duration-300"
                          style={{ opacity: opacity * 0.8 }}
                        />
                        
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div>
                            <div className="font-semibold text-lg text-slate-900 mb-1">{goal.label}</div>
                            <div className="flex items-center gap-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                {goal.completedCount} completed
                              </span>
                              {goal.startedCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                  {goal.startedCount} in progress
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* Progress indicator */}
                          <div className="flex flex-col items-end gap-1">
                            <div className="text-2xl font-bold text-slate-900">{goal.completedCount}</div>
                            <div className="text-xs text-slate-500">mastered</div>
                          </div>
                        </div>
                        
                        {/* Completed course chips */}
                        {goal.completedCourses && goal.completedCourses.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {goal.completedCourses.map(course => (
                              <button
                                key={course.id}
                                onClick={() => {
                                  setActiveCourseId(course.id);
                                  setModalOpen(true);
                                }}
                                className="group/chip px-3 py-1.5 text-sm rounded-lg bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 transition-all duration-200 border border-slate-200 hover:border-emerald-300 shadow-sm hover:shadow flex items-center gap-1.5"
                              >
                                <span className="text-emerald-600 group-hover/chip:scale-110 transition-transform">✓</span>
                                <span className="font-medium">{course.title}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      );
                    })}
                    
                    {/* Pending for Grouping */}
                    {pendingCourses.length > 0 && (
                      <div className="border border-amber-200 rounded-lg p-4 bg-gradient-to-br from-amber-50/10 to-white">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="font-semibold text-gray-900">Pending for Grouping</div>
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                            {pendingCourses.length}
                          </span>
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                          {pendingCourses.map(course => (
                            <button
                              key={course.id}
                              onClick={() => {
                                setActiveCourseId(course.id);
                                setModalOpen(true);
                              }}
                              className="px-3 py-1.5 text-sm rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors border border-gray-300"
                            >
                              ✓ {course.title}
                            </button>
                          ))}
                        </div>
                        
                        <div className="mt-3 text-xs text-gray-500">
                          Click "Regroup" to organize these courses into goals
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Course Modal */}
      {modalOpen && activeCourseId && (
        <Suspense fallback={<div>Loading course...</div>}>
          <LearnCourseModal
            open={modalOpen}
            courseId={activeCourseId}
            onClose={() => {
              setModalOpen(false);
              setActiveCourseId(null);
            }}
            onRetryGeneration={handleRetryGeneration}
          />
        </Suspense>
      )}
    </div>
  );
}

export default LearnView;

