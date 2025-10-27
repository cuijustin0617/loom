import { useEffect, useRef, useState } from 'react';
import { onAuthChanged, signInWithGoogle, signOutUser } from '../../services/firebase';
import SettingsModal from './SettingsModal';

const ProfileMenu = () => {
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const unsub = onAuthChanged(setUser);
    return () => unsub && unsub();
  }, []);

  useEffect(() => {
    const onClickAway = (e) => { if (open && ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('click', onClickAway);
    return () => window.removeEventListener('click', onClickAway);
  }, [open]);

  const initial = (user?.email || user?.displayName || 'U').slice(0, 1).toUpperCase();

  // If not logged in, show nothing (sign-in is handled on the start page)
  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 px-2 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50"
        onClick={() => setOpen(!open)}
      >
        <div className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs flex items-center justify-center">{initial}</div>
        <span className="hidden sm:block text-sm text-gray-700 max-w-[160px] truncate" title={user.email || user.uid}>{user.email || user.uid}</span>
        <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-56 rounded-md border border-gray-200 bg-white shadow-lg z-20">
          <div className="px-3 py-2 text-sm text-gray-800 border-b border-gray-100 truncate">{user.email || user.uid}</div>
          <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { setSettingsOpen(true); setOpen(false); }}>Settings</button>
          <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={signOutUser}>Log out</button>
        </div>
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

export default ProfileMenu;
