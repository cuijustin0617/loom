/**
 * Learn Course Modal
 * 
 * Displays course content and allows user to progress through modules
 */

import { useState, useEffect } from 'react';
import { useLearnStore } from '../store/learnStore';
import { useSettingsStore } from '../../../shared/store/settingsStore';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import ProgressTimer from '../../../shared/components/ProgressTimer';

export default function LearnCourseModal({ open, courseId, onClose, onRetryGeneration }) {
  const [currentModuleIdx, setCurrentModuleIdx] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  
  const getCourseWithModules = useLearnStore(state => state.getCourseWithModules);
  const updateModuleProgress = useLearnStore(state => state.updateModuleProgress);
  const isGenerating = useLearnStore(state => state.isGenerating);
  const getGenerationError = useLearnStore(state => state.getGenerationError);
  const learnModel = useSettingsStore(state => state.learnModel);
  
  const course = getCourseWithModules(courseId);
  const generating = isGenerating(courseId);
  const generationError = getGenerationError(courseId);
  
  if (!open) return null;
  
  const modules = course?.modules || [];
  const currentModule = modules[currentModuleIdx];
  const progress = course?.progressByModule || {};
  const completedCount = Object.values(progress).filter(p => p === 'done').length;
  const quiz = currentModule?.quiz || [];
  const hasQuiz = quiz.length > 0;
  
  const handleMarkDone = async () => {
    if (!currentModule) return;
    
    console.log('[LearnCourseModal] Marking module as done:', courseId, currentModule.id);
    await updateModuleProgress(courseId, currentModule.id, 'done');
    
    // Reset quiz state
    setShowQuiz(false);
    setQuizAnswers({});
    setQuizSubmitted(false);
    
    // Auto-advance to next module if not the last one
    if (currentModuleIdx < modules.length - 1) {
      setCurrentModuleIdx(currentModuleIdx + 1);
    }
  };
  
  const handleQuizAnswer = (questionIdx, answer) => {
    setQuizAnswers(prev => ({ ...prev, [questionIdx]: answer }));
  };
  
  const handleQuizSubmit = () => {
    setQuizSubmitted(true);
  };
  
  const calculateQuizScore = () => {
    let correct = 0;
    quiz.forEach((q, idx) => {
      // Use same normalization as rendering: support both formats
      const correctAnswerIndex = q.correctAnswer !== undefined ? q.correctAnswer : q.answerIndex;
      if (quizAnswers[idx] === correctAnswerIndex) {
        correct++;
      }
    });
    return { correct, total: quiz.length };
  };
  
  const handlePrevious = () => {
    if (currentModuleIdx > 0) {
      setCurrentModuleIdx(currentModuleIdx - 1);
      setShowQuiz(false);
      setQuizAnswers({});
      setQuizSubmitted(false);
    }
  };
  
  const handleNext = () => {
    if (currentModuleIdx < modules.length - 1) {
      setCurrentModuleIdx(currentModuleIdx + 1);
      setShowQuiz(false);
      setQuizAnswers({});
      setQuizSubmitted(false);
    }
  };
  
  // Reset state when opening different course or changing modules
  useEffect(() => {
    setCurrentModuleIdx(0);
    setShowQuiz(false);
    setQuizAnswers({});
    setQuizSubmitted(false);
  }, [courseId]);
  
  useEffect(() => {
    setShowQuiz(false);
    setQuizAnswers({});
    setQuizSubmitted(false);
    
    // Scroll to top when module changes
    const contentDiv = document.querySelector('.flex-1.overflow-y-auto.p-6');
    if (contentDiv) {
      contentDiv.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentModuleIdx]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-4xl max-h-[90vh] rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-white">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-semibold text-gray-900 truncate">{course?.title || 'Course'}</h2>
            <div className="flex items-center gap-3 mt-2">
              <div className="text-sm text-gray-600">
                {completedCount} / {modules.length} modules completed
              </div>
              {generating && (
                <div className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                  Generating content...
                </div>
              )}
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="flex-shrink-0 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Progress Bar */}
        {modules.length > 0 && (
          <div className="h-2 bg-gray-100">
            <div 
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${(completedCount / modules.length) * 100}%` }}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {(generating || modules.length === 0) && course?.status === 'started' ? (
            generationError ? (
              // Error state
              <div className="max-w-2xl mx-auto text-center py-12">
                <div className="mb-6 flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
                    <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Course Generation Failed
                </h3>
                <p className="text-gray-600 mb-4">
                  {generationError}
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      if (onRetryGeneration) {
                        onRetryGeneration(courseId);
                      }
                    }}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
                  >
                    Try Again
                  </button>
                  <div className="text-sm text-gray-500">
                    If the problem persists, try switching to a different model
                  </div>
                </div>
              </div>
            ) : (
              // Loading state
              <div className="max-w-2xl mx-auto text-center py-12">
              <div className="mb-6 flex justify-center">
                <ProgressTimer 
                  model={learnModel} 
                  isComplete={modules.length > 0}
                  size={140}
                  color="emerald"
                />
              </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Preparing Your Personalized Course...
                </h3>
                <p className="text-gray-600 mb-3">
                  Please wait while we create personalized lesson content based on your conversations.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200">
                  <svg className="w-5 h-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4m0-4h.01"/>
                  </svg>
                  <p className="text-sm text-amber-800">
                    Sorry, speed optimization hasn't been a focus yet, so it might be a little slow right now!
                  </p>
                </div>
              </div>
            )
          ) : currentModule ? (
            <div className="max-w-3xl mx-auto">
              {/* Module Header */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-emerald-600">
                    Module {currentModuleIdx + 1} of {modules.length}
                  </span>
                  {progress[currentModule.id] === 'done' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      ✓ Completed
                    </span>
                  )}
                </div>
                <h3 className="text-2xl font-bold text-gray-900">{currentModule.title}</h3>
                <div className="text-sm text-gray-500 mt-1">~{currentModule.estMinutes || 0} minutes</div>
              </div>

              {/* Lesson Content */}
              <>
                {currentModule.lesson ? (
                  <div className="prose prose-emerald prose-lg max-w-none">
                    <ReactMarkdown
                      rehypePlugins={[rehypeRaw]}
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({node, ...props}) => <h1 className="text-3xl font-bold text-emerald-900 mt-8 mb-4 leading-tight" {...props} />,
                        h2: ({node, ...props}) => <h2 className="text-2xl font-bold text-emerald-800 mt-6 mb-3 leading-tight" {...props} />,
                        h3: ({node, ...props}) => <h3 className="text-xl font-semibold text-emerald-700 mt-5 mb-2 leading-snug" {...props} />,
                        h4: ({node, ...props}) => <h4 className="text-lg font-semibold text-emerald-600 mt-4 mb-2 leading-snug" {...props} />,
                        p: ({node, ...props}) => <p className="mb-4 leading-relaxed text-gray-700" {...props} />,
                        ul: ({node, ...props}) => <ul className="mb-4 space-y-2 list-disc list-inside" {...props} />,
                        ol: ({node, ...props}) => <ol className="mb-4 space-y-2 list-decimal list-inside" {...props} />,
                        li: ({node, ...props}) => <li className="leading-relaxed text-gray-700" {...props} />,
                        strong: ({node, ...props}) => <strong className="font-bold text-emerald-900" {...props} />,
                        em: ({node, ...props}) => <em className="italic text-gray-800" {...props} />,
                        code: ({node, inline, className, children, ...props}) => {
                          // Inline code (backticks) vs block code (triple backticks or indented)
                          const isInline = inline !== false;
                          return isInline 
                            ? <code className="bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded text-sm font-mono whitespace-nowrap" {...props}>{children}</code>
                            : <code className="block bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto my-4 font-mono text-sm" {...props}>{children}</code>;
                        },
                        blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-emerald-500 pl-4 py-2 my-4 italic text-gray-700 bg-emerald-50 rounded-r" {...props} />,
                        hr: ({node, ...props}) => <hr className="my-6 border-t-2 border-gray-200" {...props} />,
                      }}
                    >
                      {currentModule.lesson}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-gray-500 text-center py-8">
                    {generating ? 'Content is being generated...' : 'No lesson content available'}
                  </div>
                )}
                
                {/* Inline Quiz - Show directly after lesson */}
                {hasQuiz && currentModule.lesson && (
                  <div className="mt-8 space-y-6 border-t-2 border-gray-200 pt-8">
                    <div className="text-center mb-6">
                      <h4 className="text-xl font-bold text-gray-900">Check Your Understanding !</h4>
                      <p className="text-gray-600 text-sm mt-1">Answer these questions to test what you've learned</p>
                    </div>
                    
                    {quiz.map((question, qIdx) => {
                    // Normalize quiz format: support both AI-generated (prompt/choices/answerIndex) and standard (question/options/correctAnswer)
                    const questionText = question.question || question.prompt;
                    const questionOptions = question.options || question.choices;
                    const correctAnswerIndex = question.correctAnswer !== undefined ? question.correctAnswer : question.answerIndex;
                    
                    // Defensive check: ensure question has proper structure
                    if (!question || !questionOptions || !Array.isArray(questionOptions)) {
                      console.warn('[LearnCourseModal] Malformed quiz question:', question);
                      return null;
                    }
                    
                    return (
                    <div key={qIdx} className="p-4 border border-gray-200 rounded-lg bg-white">
                      <div className="font-medium text-gray-900 mb-3">
                        {qIdx + 1}. {questionText || 'Question'}
                      </div>
                      
                      <div className="space-y-2">
                        {questionOptions.map((option, oIdx) => {
                          const isSelected = quizAnswers[qIdx] === oIdx;
                          const isCorrect = oIdx === correctAnswerIndex;
                          const showFeedback = quizSubmitted;
                          
                          let buttonClass = 'w-full text-left p-3 rounded-lg border transition-colors ';
                          if (showFeedback) {
                            if (isCorrect) {
                              buttonClass += 'border-emerald-500 bg-emerald-50 text-emerald-900';
                            } else if (isSelected && !isCorrect) {
                              buttonClass += 'border-red-500 bg-red-50 text-red-900';
                            } else {
                              buttonClass += 'border-gray-200 bg-gray-50 text-gray-600';
                            }
                          } else {
                            buttonClass += isSelected 
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                              : 'border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/50';
                          }
                          
                          return (
                            <button
                              key={oIdx}
                              onClick={() => !quizSubmitted && handleQuizAnswer(qIdx, oIdx)}
                              disabled={quizSubmitted}
                              className={buttonClass}
                            >
                              <div className="flex items-center gap-2">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-medium">
                                  {String.fromCharCode(65 + oIdx)}
                                </span>
                                <span className="flex-1">{option}</span>
                                {showFeedback && isCorrect && (
                                  <span className="text-emerald-600">✓</span>
                                )}
                                {showFeedback && isSelected && !isCorrect && (
                                  <span className="text-red-600">✗</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      
                      {quizSubmitted && question.explanation && (
                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
                          <strong>Explanation:</strong> {question.explanation}
                        </div>
                      )}
                    </div>
                    );
                  })}
                  
                  {quizSubmitted ? (
                    <div className="text-center py-4">
                      {(() => {
                        const { correct, total } = calculateQuizScore();
                        const percentage = (correct / total) * 100;
                        return (
                          <div>
                            <div className="text-2xl font-bold text-gray-900 mb-2">
                              Score: {correct} / {total} ({percentage.toFixed(0)}%)
                            </div>
                            {percentage >= 80 ? (
                              <div className="text-emerald-600 font-medium">🎉 Great job!</div>
                            ) : percentage >= 60 ? (
                              <div className="text-amber-600 font-medium">👍 Good effort!</div>
                            ) : (
                              <div className="text-gray-600 font-medium">📚 Keep practicing!</div>
                            )}
                            <div className="mt-4">
                              <button
                                onClick={handleMarkDone}
                                className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
                              >
                                {percentage >= 60 ? 'Mark as Done & Continue' : 'Continue Anyway'}
                              </button>
                              {percentage < 60 && (
                                <p className="text-sm text-gray-500 mt-2">You can always retry the quiz later!</p>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="text-center">
                      <button
                        onClick={handleQuizSubmit}
                        disabled={Object.keys(quizAnswers).length === 0}
                        className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                      >
                        Submit Answers
                      </button>
                      <div className="text-sm text-gray-500 mt-2">
                        {Object.keys(quizAnswers).length} / {quiz.length} answered
                        {Object.keys(quizAnswers).length < quiz.length && (
                          <span className="text-amber-600 ml-2">(You can submit partial answers)</span>
                        )}
                      </div>
                    </div>
                  )}
                  </div>
                )}
              </>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto text-center py-12">
              <p className="text-gray-600">
                {generating ? 'Preparing your personalized course...' : 'No modules available'}
              </p>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        {modules.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
            <button
              onClick={handlePrevious}
              disabled={currentModuleIdx === 0}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ← Previous
            </button>
            
            <div className="flex items-center gap-2">
              {modules.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentModuleIdx(idx)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    idx === currentModuleIdx 
                      ? 'bg-emerald-600 w-8' 
                      : progress[modules[idx]?.id] === 'done'
                        ? 'bg-emerald-500'
                        : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
            
            {progress[currentModule?.id] !== 'done' ? (
              showQuiz ? (
                <button
                  onClick={() => setShowQuiz(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-white transition-colors"
                >
                  Back to Lesson
                </button>
              ) : (
                <button
                  onClick={handleMarkDone}
                  className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  {hasQuiz ? 'Skip Quiz & Mark Done' : 'Mark as Done'}
                </button>
              )
            ) : currentModuleIdx < modules.length - 1 ? (
              <button
                onClick={handleNext}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                Complete Course ✓
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
