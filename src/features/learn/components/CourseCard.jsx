/**
 * CourseCard Component
 * 
 * Displays a course/outline preview card.
 */

// Helper: render inline markdown (simple)
function renderInlineMarkdown(md) {
  let s = String(md || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  s = s.replace(/\[(.+?)\]\((https?:\/\/[^\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>');
  s = s.replace(/`([^`]+)`/g, '<code>$1<\/code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1<\/strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1<\/em>');
  s = s.replace(/\n/g, '<br/>');
  return s;
}

// Status badge
function StatusBadge({ status }) {
  if (!status) return null;
  const map = {
    suggested: 'bg-gray-100 text-gray-700',
    saved: 'bg-blue-100 text-blue-800',
    started: 'bg-emerald-100 text-emerald-800',
    completed: 'bg-emerald-200 text-emerald-900',
    dismissed: 'bg-gray-100 text-gray-500'
  };
  return (
    <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded ${map[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

// Module stepper (progress indicator)
function ModuleStepper({ course }) {
  if (!course || course.status !== 'started') return null;
  const mods = Array.isArray(course.modules) ? course.modules : Array.isArray(course.moduleSummary) ? course.moduleSummary : [];
  const prog = course.progressByModule || {};
  const total = mods.length;
  if (total === 0) return null;
  
  const doneCount = Object.values(prog).filter(v => v === 'done').length;
  
  return (
    <div className="flex items-center gap-1">
      {mods.map((m, i) => {
        const moduleId = m.id || `mod-${i}`;
        const isDone = prog[moduleId] === 'done';
        return (
          <span 
            key={moduleId} 
            className={`inline-block w-1.5 h-1.5 rounded-full ${isDone ? 'bg-emerald-600' : 'bg-gray-300'}`} 
          />
        );
      })}
      <span className="ml-1 text-[11px] text-gray-500">{doneCount}/{total}</span>
    </div>
  );
}

function CourseCard({ 
  outline, 
  onStart, 
  onSave, 
  onDismiss, 
  onAlreadyKnow, 
  showGoalTag = false, 
  kind = null, 
  onlyPrimaryAndRemove = false 
}) {
  const modules = outline.modules || outline.moduleSummary || [];
  const questions = outline.questions || outline.questions_you_will_answer || outline.questionIds || [];
  const whySuggested = outline.whySuggested || outline.why_suggested || '';
  
  const moduleCount = modules.length;
  const totalMinutes = modules.reduce((s, m) => s + (Number(m.estMinutes || m.est_minutes) || 0), 0);
  const primaryLabel = outline.status === 'started' ? 'Continue' : 'Start';
  const showSave = outline.status === 'suggested';
  const showDismiss = outline.status === 'suggested' || outline.status === 'saved';
  
  // Visual tone based on status/kind
  const tone = outline.status === 'started'
    ? { box: 'border-amber-300', accent: 'border-l-amber-500', bg: 'bg-gradient-to-br from-amber-50/20 to-white' }
    : (kind === 'explore'
        ? { box: 'border-emerald-300', accent: 'border-l-emerald-500', bg: 'bg-gradient-to-br from-emerald-50/1 to-white' }
        : { box: 'border-emerald-200', accent: 'border-l-emerald-400', bg: 'bg-gradient-to-br from-emerald-50/5 to-white' });
  
  return (
    <div className={`h-full flex flex-col border ${tone.box} border-l-4 ${tone.accent} rounded-lg p-4 ${tone.bg} shadow-sm overflow-hidden`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          <div className="text-[15px] md:text-base font-semibold text-gray-900 leading-snug line-clamp-2">
            {outline.title}
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {showGoalTag && outline.goal && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-emerald-300 text-emerald-800 bg-emerald-50">
                {outline.goal}
              </span>
            )}
            {kind && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                kind === 'explore' 
                  ? 'border-violet-300 text-violet-700 bg-violet-50' 
                  : 'border-amber-300 text-amber-800 bg-amber-50'
              }`}>
                {kind === 'explore' ? 'Explore' : 'Strengthen'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={outline.status} />
        </div>
      </div>
      
      {/* Why suggested */}
      {whySuggested && (
        <div 
          className="text-sm text-gray-700 line-clamp-3 mb-2" 
          dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(whySuggested) }} 
        />
      )}
      
      {/* Questions */}
      {questions.length > 0 && (
        <ul className="list-disc list-inside text-[12px] text-gray-800 mb-2">
          {questions.slice(0, 4).map((q, i) => (
            <li key={i} className="line-clamp-1">{q}</li>
          ))}
        </ul>
      )}
      
      {/* Modules preview */}
      {modules.length > 0 && (
        <div className="mb-2">
          <div className="text-[11px] text-gray-500 mb-1">Modules</div>
          <ul className="list-disc list-inside text-[12px] text-gray-800">
            {modules.slice(0, 4).map((m, i) => (
              <li key={i} className="truncate">{m.title}</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Meta row */}
      <div className="mb-2 text-[12px] text-gray-600 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
            {moduleCount > 0 ? `${moduleCount} module${moduleCount > 1 ? 's' : ''}` : '4 modules'}
          </span>
          <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
            ~{totalMinutes || 20}m
          </span>
        </div>
        <ModuleStepper course={outline} />
      </div>
      
      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 flex-nowrap">
        <button 
          onClick={onStart} 
          className="h-[42px] px-3 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
        >
          {primaryLabel}
        </button>
        
        {onlyPrimaryAndRemove ? (
          <button 
            onClick={onDismiss} 
            className="h-[42px] px-3 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Remove
          </button>
        ) : (
          <>
            {showSave && (
              <button 
                onClick={onSave} 
                className="h-[42px] px-3 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Save
              </button>
            )}
            {showDismiss && (
              <button 
                onClick={onDismiss} 
                className="h-[42px] px-2.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-normal w-28 leading-tight transition-colors"
              >
                Not interested
              </button>
            )}
            <button 
              onClick={onAlreadyKnow} 
              className="h-[42px] px-2.5 text-sm rounded-md border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 whitespace-normal w-28 leading-tight transition-colors"
            >
              Already know it
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default CourseCard;

