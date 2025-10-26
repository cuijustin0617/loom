import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function ModeToggle({ mode = 'chat', onChange, size = 'md', className = '' }) {
  const isLearn = mode === 'learn';
  const sz = size === 'sm'
    ? { pad: 'px-2 py-1', brandText: 'text-base', segText: 'text-xs', segPad: 'px-3 py-1', h: 30 }
    : { pad: 'px-3 py-1.5', brandText: 'text-xl', segText: 'text-sm', segPad: 'px-4 py-1.5', h: 34 };

  const trackRef = useRef(null);
  const chatRef = useRef(null);
  const learnRef = useRef(null);
  const [slider, setSlider] = useState({ left: 0, width: 0 });

  const recalc = () => {
    const track = trackRef.current;
    const chatEl = chatRef.current;
    const learnEl = learnRef.current;
    if (!track || !chatEl || !learnEl) return;
    const target = isLearn ? learnEl : chatEl;
    const left = target.offsetLeft;
    const width = target.offsetWidth;
    setSlider({ left, width });
  };

  useLayoutEffect(() => { recalc(); }, [isLearn]);
  useEffect(() => {
    recalc();
    const ro = new ResizeObserver(() => recalc());
    if (trackRef.current) ro.observe(trackRef.current);
    if (chatRef.current) ro.observe(chatRef.current);
    if (learnRef.current) ro.observe(learnRef.current);
    window.addEventListener('resize', recalc);
    return () => { ro.disconnect(); window.removeEventListener('resize', recalc); };
  }, []);

  return (
    <div
      className={`inline-flex items-center rounded-full border border-gray-200/60 bg-white/75 backdrop-blur-md shadow-[0_4px_16px_rgba(0,0,0,0.06)] ${sz.pad} ${className} cursor-pointer select-none`}
      role="group"
      aria-label="Mode toggle"
      tabIndex={0}
      onClick={() => onChange && onChange(isLearn ? 'chat' : 'learn')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange && onChange(isLearn ? 'chat' : 'learn'); } }}
    >
      {/* Brand */}
      <div className="flex items-center">
        <div className={`transition-colors duration-300 font-bold ${sz.brandText} ${isLearn ? 'text-emerald-700' : 'text-violet-700'}`}>LOOM</div>
      </div>
      {/* Divider */}
      <div className="mx-2 w-px self-stretch bg-gray-200" aria-hidden="true" />
      {/* Segmented toggle */}
      <div
        ref={trackRef}
        className="relative flex items-center rounded-full bg-gray-100/80 px-1 py-1"
        style={{ height: sz.h }}
      >
        {/* Animated slider sized to active button */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full transition-[left,width] duration-250 ease-[cubic-bezier(.2,.8,.2,1)] will-change-[left,width]"
          style={{
            left: slider.left,
            width: slider.width,
            height: sz.h - 8,
            background: isLearn ? 'rgba(16,185,129,0.18)' : 'rgba(109,40,217,0.18)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
          }}
          aria-hidden="true"
        />
        <button
          ref={chatRef}
          type="button"
          aria-pressed={!isLearn}
          onClick={(e) => { e.stopPropagation(); onChange && onChange(isLearn ? 'chat' : 'learn'); }}
          className={`relative ${sz.segPad} ${sz.segText} rounded-full font-semibold transition-colors active:scale-[0.98] ${!isLearn ? 'text-violet-800' : 'text-gray-600'}`}
        >
          Chat
        </button>
        <button
          ref={learnRef}
          type="button"
          aria-pressed={isLearn}
          onClick={(e) => { e.stopPropagation(); onChange && onChange(isLearn ? 'chat' : 'learn'); }}
          className={`relative ${sz.segPad} ${sz.segText} rounded-full font-semibold transition-colors active:scale-[0.98] ${isLearn ? 'text-emerald-800' : 'text-gray-600'}`}
        >
          Learn
        </button>
      </div>
    </div>
  );
}
