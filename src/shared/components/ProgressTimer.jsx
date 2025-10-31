/**
 * Progress Timer Component
 * 
 * Displays a pseudo-progress circle that completes based on model-specific duration.
 * If generation finishes early, the timer completes immediately.
 * If generation takes longer, the timer stays at 100% with a pulsing effect.
 */

import { useEffect, useState } from 'react';

/**
 * Get duration in seconds based on model
 * @param {string} model - Model name
 * @returns {number} Duration in seconds
 */
function getModelDuration(model) {
  if (!model) return 30; // Default to flash duration
  
  const modelLower = model.toLowerCase();
  
  if (modelLower.includes('lite')) {
    return 10; // Flash Lite: 10 seconds
  } else if (modelLower.includes('pro')) {
    return 50; // Pro: 50 seconds
  } else {
    return 30; // Flash: 30 seconds (default)
  }
}

/**
 * Progress Timer Component
 * @param {Object} props
 * @param {string} props.model - Current model being used
 * @param {boolean} props.isComplete - Whether generation is complete
 * @param {number} props.size - Size of the circle in pixels (default: 120)
 * @param {string} props.color - Color theme (default: 'emerald')
 * @param {number} props.durationMultiplier - Multiplier for duration (default: 1.0)
 */
export default function ProgressTimer({ model, isComplete = false, size = 120, color = 'emerald', durationMultiplier = 1.0 }) {
  const [progress, setProgress] = useState(0);
  const [isWaiting, setIsWaiting] = useState(false);
  
  const duration = getModelDuration(model) * durationMultiplier;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  
  useEffect(() => {
    if (isComplete) {
      // If complete, jump to 100% immediately
      setProgress(100);
      setIsWaiting(false);
      return;
    }
    
    // Start progress animation
    const startTime = Date.now();
    const intervalMs = 50; // Update every 50ms for smooth animation
    
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min(100, (elapsed / (duration * 1000)) * 100);
      
      setProgress(newProgress);
      
      // If we reach 100% but not complete, enter waiting state
      if (newProgress >= 100 && !isComplete) {
        setIsWaiting(true);
        clearInterval(timer);
      }
    }, intervalMs);
    
    return () => clearInterval(timer);
  }, [duration, isComplete]);
  
  // Color schemes
  const colorSchemes = {
    emerald: {
      track: 'stroke-emerald-200',
      progress: 'stroke-emerald-600',
      pulse: 'stroke-emerald-500',
      text: 'text-emerald-700',
      bg: 'bg-emerald-100'
    },
    amber: {
      track: 'stroke-amber-200',
      progress: 'stroke-amber-600',
      pulse: 'stroke-amber-500',
      text: 'text-amber-700',
      bg: 'bg-amber-100'
    }
  };
  
  const scheme = colorSchemes[color] || colorSchemes.emerald;
  
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={scheme.track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={`${isWaiting ? scheme.pulse : scheme.progress} transition-all duration-100`}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            animation: isWaiting ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none'
          }}
        />
      </svg>
      
      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className={`text-2xl font-bold ${scheme.text}`}>
            {Math.round(progress)}%
          </div>
          {isWaiting && (
            <div className={`text-xs ${scheme.text} mt-1 animate-pulse`}>
              Finalizing...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

