import { useEffect } from 'react';
import { MapView } from './components/MapView';
import { AuthGuard } from './components/auth/AuthGuard';
import { authClient } from './lib/auth-client';
import { useMapStore } from './stores/useMapStore';
import { useUIStore } from './stores/useUIStore';

/**
 * Inner app content rendered only when authenticated.
 *
 * On initial load, if no map exists, switches the side panel
 * to the Create tab so the user can generate a new map.
 * Once a map is created, the canvas shows the generated terrain grid.
 */
function AppContent() {
  const hexCount = useMapStore((s) => s.hexes.size);
  const setSidePanel = useUIStore((s) => s.setSidePanel);

  // On first load with no map, show the Create tab
  useEffect(() => {
    if (hexCount === 0) {
      setSidePanel('create');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only on mount

  const handleLogout = async () => {
    await authClient.signOut();
  };

  return (
    <div className="relative">
      <MapView />
      <button
        type="button"
        onClick={handleLogout}
        className="fixed top-3 right-3 z-50 px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-800/80 hover:bg-gray-700/90 border border-gray-600 rounded transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}

/**
 * App root component.
 *
 * AuthGuard wraps the entire app: unauthenticated users see
 * login/signup pages; authenticated users see the hex map.
 */
function App() {
  return (
    <AuthGuard>
      <AppContent />
    </AuthGuard>
  );
}

export default App;
