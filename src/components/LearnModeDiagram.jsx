import React from 'react';

// Publication-ready LEARN mode system diagram
// Responsive SVG with Tailwind classes; embed anywhere via <LearnModeDiagram />
export default function LearnModeDiagram({ className = '' }) {
  const w = 1200;
  const h = 720;
  return (
    <div className={`w-full overflow-x-auto ${className}`}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto" role="img" aria-label="LEARN mode system diagram"
      >
        {/* Background */}
        <defs>
          <linearGradient id="gPanel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ecfdf5" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>
          <linearGradient id="gLLM" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a7f3d0" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <linearGradient id="gData" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#dbeafe" />
            <stop offset="100%" stopColor="#bfdbfe" />
          </linearGradient>
          <linearGradient id="gGoal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#065f46" />
          </marker>
          <filter id="shadow">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#0f172a33" />
          </filter>
        </defs>

        {/* Title */}
        <text x={w/2} y={42} textAnchor="middle" className="fill-emerald-900" style={{fontSize: 20, fontWeight: 700}}>
          LEARN Mode: Conversation → Goals → Lesson Generation
        </text>

        {/* Panels layout grid */}
        {/* Left: User + Chats */}
        <g transform="translate(40,80)">
          <rect width="320" height="240" rx="14" fill="url(#gPanel)" stroke="#a7f3d0" className="" filter="url(#shadow)"/>
          <text x="16" y="28" className="fill-emerald-900" style={{fontSize: 14, fontWeight: 700}}>User Chats</text>

          {/* User icon */}
          <circle cx="44" cy="70" r="18" fill="#d1fae5" stroke="#10b981" />
          <circle cx="44" cy="64" r="6" fill="#10b981" />
          <path d="M28,78 q16,14 32,0" fill="#10b981" />

          {/* Chat cards */}
          {Array.from({length: 4}).map((_,i)=> (
            <g key={i} transform={`translate(${84 + i*54}, 52)`}>
              <rect width="46" height="64" rx="8" fill="#fff" stroke="#a7f3d0" />
              <rect x="10" y="12" width="26" height="6" rx="3" fill="#34d399" />
              <rect x="10" y="24" width="22" height="6" rx="3" fill="#d1fae5" />
              <rect x="10" y="36" width="18" height="6" rx="3" fill="#d1fae5" />
            </g>
          ))}

          <text x="16" y="214" className="fill-slate-600" style={{fontSize: 12}}>Free‑form multi‑turn conversations</text>
        </g>

        {/* Mid-left: Summarizer (LLM) */}
        <g transform="translate(420,100)">
          <rect width="280" height="120" rx="14" fill="#ffffff" stroke="#6ee7b7" filter="url(#shadow)" />
          <rect x="0" y="0" width="280" height="36" rx="14" fill="url(#gLLM)" />
          <text x="140" y="24" textAnchor="middle" className="fill-emerald-900" style={{fontSize: 13, fontWeight: 800}}>LLM Summarizer</text>
          <text x="20" y="64" className="fill-slate-700" style={{fontSize: 12}}>• One‑line chat summaries</text>
          <text x="20" y="84" className="fill-slate-700" style={{fontSize: 12}}>• Goal and difficulty hints</text>
        </g>

        {/* Arrow: Chats → Summarizer with LLM pill near arrow */}
        <g>
          <path d="M360 160 C 390 160, 390 160, 420 160" stroke="#065f46" strokeWidth="2.5" fill="none" markerEnd="url(#arrow)" />
          <rect x="375" y="140" rx="10" width="44" height="20" fill="#ecfdf5" stroke="#10b981" />
          <text x="397" y="154" textAnchor="middle" className="fill-emerald-800" style={{fontSize: 11, fontWeight: 700}}>LLM</text>
        </g>

        {/* Mid: Chat Summaries store */}
        <g transform="translate(420,250)">
          <rect width="280" height="120" rx="12" fill="url(#gData)" stroke="#93c5fd" filter="url(#shadow)" />
          <text x="140" y="28" textAnchor="middle" className="fill-slate-900" style={{fontSize: 13, fontWeight: 700}}>Chat Summaries + Signals</text>
          <text x="140" y="48" textAnchor="middle" className="fill-slate-600" style={{fontSize: 11}}>(one‑liners, goal hints, recency)</text>
        </g>

        {/* Right‑top: Goal Knowledge Graph */}
        <g transform="translate(760,70)">
          <rect width="380" height="240" rx="14" fill="#fff" stroke="#f59e0b" filter="url(#shadow)" />
          <rect x="0" y="0" width="380" height="34" rx="14" fill="url(#gGoal)" />
          <text x="190" y="22" textAnchor="middle" className="fill-amber-900" style={{fontSize: 13, fontWeight: 800}}>Goal Knowledge Graph</text>

          {/* Graph nodes */}
          <g transform="translate(26,60)">
            {/* Edges */}
            <path d="M40 20 L 140 70 L 240 20 L 320 100" stroke="#f59e0b" strokeWidth="2" fill="none" />
            <path d="M140 70 L 240 140" stroke="#f59e0b" strokeWidth="2" fill="none" />
            {/* Nodes */}
            {[
              [40,20,'G1: Linear Algebra'],
              [140,70,'G2: ML Basics'],
              [240,20,'G3: Python'],
              [320,100,'G4: LLM Apps'],
              [240,140,'G5: Evaluation']
            ].map(([x,y,label],i)=> (
              <g key={i}>
                <circle cx={x} cy={y} r={18} fill="#fef3c7" stroke="#f59e0b" />
                <text x={x} y={y+34} textAnchor="middle" className="fill-amber-900" style={{fontSize: 10}}>{label}</text>
              </g>
            ))}
          </g>
          <text x="190" y="224" textAnchor="middle" className="fill-slate-700" style={{fontSize: 11}}>labels aggregate courses, completions, hints</text>
        </g>

        {/* Center-right: Outline Proposer (LLM) */}
        <g transform="translate(760,330)">
          <rect width="380" height="120" rx="14" fill="#ffffff" stroke="#6ee7b7" filter="url(#shadow)" />
          <rect x="0" y="0" width="380" height="36" rx="14" fill="url(#gLLM)" />
          <text x="190" y="24" textAnchor="middle" className="fill-emerald-900" style={{fontSize: 13, fontWeight: 800}}>LLM: Topic + Mini‑Course Proposer</text>
          <text x="24" y="64" className="fill-slate-700" style={{fontSize: 12}}>Inputs: goal graph, chat summaries, avoid list</text>
          <text x="24" y="86" className="fill-slate-700" style={{fontSize: 12}}>Outputs: suggested mini‑courses with modules</text>
        </g>

        {/* Arrows: Summaries → Proposer; Goals → Proposer */}
        <g>
          <path d="M700 310 C 740 310, 740 360, 760 360" stroke="#065f46" strokeWidth="2.5" fill="none" markerEnd="url(#arrow)" />
          <rect x="720" y="332" rx="10" width="44" height="20" fill="#ecfdf5" stroke="#10b981" />
          <text x="742" y="346" textAnchor="middle" className="fill-emerald-800" style={{fontSize: 11, fontWeight: 700}}>LLM</text>

          <path d="M950 310 C 950 310, 950 330, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
          <path d="M950 310 C 950 330, 950 330, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
          <path d="M950 310 C 950 330, 950 330, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
          <path d="M950 310 C 950 330, 950 330, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
          {/* actual arrow from goals panel bottom to proposer */}
          <path d="M950 310 C 950 330, 950 330, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
        </g>

        {/* Arrow: Goals → Proposer (explicit path) */}
        <path d="M950 310 C 950 340, 950 340, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
        <g>
          <path d="M950 310 C 950 330, 950 330, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
        </g>

        {/* Visible arrow from Goals to Proposer */}
        <g>
          <path d="M950 310 C 950 330, 950 330, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
        </g>

        <g>
          <path d="M950 310 C 950 330, 950 330, 950 330" stroke="#065f46" strokeWidth="0" fill="none" />
        </g>

        {/* Explicit simple arrow from goal panel to proposer */}
        <g>
          <path d="M950 310 L 950 330 L 950 330" stroke="#065f46" strokeWidth="2.5" fill="none" markerEnd="url(#arrow)" />
          <rect x="928" y="318" rx="10" width="44" height="20" fill="#ecfdf5" stroke="#10b981" />
          <text x="950" y="332" textAnchor="middle" className="fill-emerald-800" style={{fontSize: 11, fontWeight: 700}}>LLM</text>
        </g>

        {/* Bottom-right: Suggested mini‑courses list */}
        <g transform="translate(760,480)">
          <rect width="380" height="180" rx="14" fill="url(#gData)" stroke="#93c5fd" filter="url(#shadow)" />
          <text x="20" y="28" className="fill-slate-900" style={{fontSize: 13, fontWeight: 700}}>Mini‑Course Suggestions</text>
          {[
            ['Strengthen: Vector Spaces','Goal → Linear Algebra'],
            ['Explore: Prompt Engineering Basics','Goal → LLM Apps'],
            ['Strengthen: Metrics & Evaluation','Goal → Evaluation']
          ].map((row, i) => (
            <g key={i} transform={`translate(20, ${50 + i*40})`}>
              <rect width="340" height="30" rx="8" fill="#fff" stroke="#bfdbfe" />
              <text x="12" y="20" className="fill-slate-800" style={{fontSize: 12}}>{row[0]}</text>
              <rect x="250" y="7" width="110" height="16" rx="8" fill="#ecfeff" stroke="#67e8f9" />
              <text x="305" y="20" textAnchor="middle" className="fill-sky-700" style={{fontSize: 10}}>{row[1]}</text>
            </g>
          ))}
        </g>

        {/* Bottom center: Course generator LLM */}
        <g transform="translate(420,520)">
          <rect width="280" height="120" rx="14" fill="#ffffff" stroke="#6ee7b7" filter="url(#shadow)" />
          <rect x="0" y="0" width="280" height="36" rx="14" fill="url(#gLLM)" />
          <text x="140" y="24" textAnchor="middle" className="fill-emerald-900" style={{fontSize: 13, fontWeight: 800}}>LLM: Course Generator</text>
          <text x="20" y="64" className="fill-slate-700" style={{fontSize: 12}}>Inputs: chosen outline + chat excerpts</text>
          <text x="20" y="84" className="fill-slate-700" style={{fontSize: 12}}>Outputs: lessons, micro‑tasks, refs</text>
        </g>

        {/* Arrows: Suggestions → Course Generator; back to Goals (contribution) */}
        <g>
          <path d="M940 560 C 880 560, 760 560, 700 560" stroke="#065f46" strokeWidth="2.5" fill="none" markerEnd="url(#arrow)" />
          <rect x="780" y="540" rx="10" width="60" height="20" fill="#ecfdf5" stroke="#10b981" />
          <text x="810" y="554" textAnchor="middle" className="fill-emerald-800" style={{fontSize: 11, fontWeight: 700}}>User pick</text>
        </g>

        {/* Output: Lessons contributing to goals */}
        <g transform="translate(80,480)">
          <rect width="300" height="160" rx="14" fill="#fff" stroke="#10b981" filter="url(#shadow)" />
          <rect x="0" y="0" width="300" height="34" rx="14" fill="url(#gLLM)" />
          <text x="150" y="22" textAnchor="middle" className="fill-emerald-900" style={{fontSize: 13, fontWeight: 800}}>Lessons + Progress</text>
          {['Module 1: Concept lesson','Module 2: Micro‑task','Module 3: Practice quiz'].map((t,i)=> (
            <g key={i} transform={`translate(18, ${56 + i*32})`}>
              <rect width="264" height="26" rx="6" fill="#ecfdf5" stroke="#a7f3d0" />
              <text x="10" y="18" className="fill-emerald-900" style={{fontSize: 12}}>{t}</text>
            </g>
          ))}
        </g>

        {/* Arrows: Generator → Lessons; Lessons → Goals (contribution) */}
        <g>
          <path d="M420 580 C 360 580, 280 560, 220 560" stroke="#065f46" strokeWidth="2.5" fill="none" markerEnd="url(#arrow)" />
          <rect x="314" y="556" rx="10" width="76" height="20" fill="#ecfdf5" stroke="#10b981" />
          <text x="352" y="570" textAnchor="middle" className="fill-emerald-800" style={{fontSize: 11, fontWeight: 700}}>Generated</text>

          <path d="M380 520 C 620 480, 980 420, 980 310" stroke="#93370d" strokeWidth="2" strokeDasharray="4 4" fill="none" markerEnd="url(#arrow)" />
          <text x="770" y="470" className="fill-amber-900" style={{fontSize: 11, fontWeight: 700}}>Completion updates goal graph</text>
        </g>

        {/* Legend */}
        <g transform="translate(40,664)">
          <rect width="1120" height="40" rx="10" fill="#ffffff" stroke="#e2e8f0" />
          <g transform="translate(16,12)">
            <rect x="0" y="-8" width="40" height="16" rx="8" fill="url(#gLLM)" stroke="#10b981" />
            <text x="22" y="4" textAnchor="middle" className="fill-emerald-900" style={{fontSize: 11, fontWeight: 800}}>LLM</text>
            <text x="56" y="4" className="fill-slate-600" style={{fontSize: 12}}>operation on arrow or module header</text>
          </g>
          <g transform="translate(420,12)">
            <rect x="0" y="-8" width="14" height="14" rx="3" fill="#bfdbfe" stroke="#60a5fa" />
            <text x="22" y="4" className="fill-slate-600" style={{fontSize: 12}}>data store / list</text>
          </g>
          <g transform="translate(720,12)">
            <rect x="0" y="-8" width="14" height="14" rx="3" fill="#fde68a" stroke="#f59e0b" />
            <text x="22" y="4" className="fill-slate-600" style={{fontSize: 12}}>goal knowledge graph</text>
          </g>
        </g>
      </svg>
    </div>
  );
}

