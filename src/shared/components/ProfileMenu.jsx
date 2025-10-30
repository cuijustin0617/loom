import { useEffect, useRef, useState } from 'react';
import { onAuthChanged, signInWithGoogle, signOutUser } from '../../services/firebase';
import SettingsModal from './SettingsModal';

const ProfileMenu = () => {
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
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

  const handleLogout = async () => {
    if (!confirm('Are you sure you want to log out? Your data is synced to your account and will be available when you log back in.')) {
      return;
    }
    
    setLoggingOut(true);
    setOpen(false);
    
    try {
      await signOutUser();
      // Show success message briefly before reload
      alert('Successfully logged out! Reloading app...');
      window.location.reload();
    } catch (error) {
      console.error('Logout failed:', error);
      alert('Logout failed. Please try again.');
      setLoggingOut(false);
    }
  };

  const initial = (user?.email || user?.displayName || 'U').slice(0, 1).toUpperCase();

  // If not logged in, show nothing (sign-in is handled on the start page)
  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 px-2 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50"
        onClick={() => setOpen(!open)}
        disabled={loggingOut}
      >
        <div className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs flex items-center justify-center">{initial}</div>
        <span className="hidden sm:block text-sm text-gray-700 max-w-[160px] truncate" title={user.email || user.uid}>{user.email || user.uid}</span>
        <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-56 rounded-md border border-gray-200 bg-white shadow-lg z-20">
          <div className="px-3 py-2 text-sm text-gray-800 border-b border-gray-100 truncate">{user.email || user.uid}</div>
          <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { setSettingsOpen(true); setOpen(false); }}>Settings</button>
          <button 
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100" 
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? 'Logging out...' : 'Log out'}
          </button>
        </div>
      )}

      {loggingOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin"></div>
              <span className="text-gray-900">Logging out...</span>
            </div>
          </div>
        </div>
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

export default ProfileMenu;
