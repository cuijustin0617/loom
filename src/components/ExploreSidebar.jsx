import Logo from './Logo';

export default function ExploreSidebar({
  activeTab,
  onChangeTab,
  onExitExplore,
  savedCount = 0,
  sessionCount = 0,
}) {
  const Item = ({ id, label, count }) => (
    <button
      onClick={() => onChangeTab(id)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm ${
        activeTab === id
          ? 'bg-emerald-100 text-emerald-700 font-medium'
          : 'text-gray-800 hover:bg-emerald-50'
      }`}
    >
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className="text-xs rounded-full bg-white/70 border border-emerald-200 px-2 py-0.5">{count}</span>
      )}
    </button>
  );

  return (
    <div className="h-full w-64 border-r border-emerald-200 bg-emerald-50/60 flex flex-col">
      <div className="p-3 border-b border-emerald-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo />
          <div className="text-sm text-emerald-700 font-semibold">Explore</div>
        </div>
        <button onClick={onExitExplore} className="px-2.5 py-1 text-sm rounded-md border border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white">
          Chat
        </button>
      </div>
      <div className="p-3 space-y-1">
        <Item id="feed" label="Feed" />
        <Item id="saved" label="Saved" count={savedCount} />
        <Item id="sessions" label="Sessions" count={sessionCount} />
      </div>
      <div className="mt-auto p-3 text-xs text-gray-500">
        Tips: Use intent and chips to tailor your batch. Swap replaces a single card.
      </div>
    </div>
  );
}

