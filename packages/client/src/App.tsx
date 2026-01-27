import { useState, useEffect } from 'react';
import { MapView } from './components/MapView';
import { AuthGuard } from './components/auth/AuthGuard';
import { CampaignList } from './components/campaigns/CampaignList';
import { CampaignDashboard } from './components/campaigns/CampaignDashboard';
import { authClient } from './lib/auth-client';
import { useMapStore } from './stores/useMapStore';
import { useUIStore } from './stores/useUIStore';

type AppView = 'campaigns' | 'dashboard' | 'map';

/**
 * Inner app content rendered only when authenticated.
 *
 * Navigation flow:
 *   campaigns (list) -> dashboard (campaign detail) -> map (hex map)
 *
 * Uses simple state-based view switching (no router).
 */
function AppContent() {
  const [view, setView] = useState<AppView>('campaigns');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const hexCount = useMapStore((s) => s.hexes.size);
  const setSidePanel = useUIStore((s) => s.setSidePanel);

  // When entering map view with no map, show the Create tab
  useEffect(() => {
    if (view === 'map' && hexCount === 0) {
      setSidePanel('create');
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    await authClient.signOut();
  };

  const handleSelectCampaign = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    setView('dashboard');
  };

  const handleBackToCampaigns = () => {
    setSelectedCampaignId(null);
    setView('campaigns');
  };

  const handleEnterMap = () => {
    setView('map');
  };

  const handleBackFromMap = () => {
    setView('dashboard');
  };

  return (
    <div className="relative">
      {view === 'campaigns' && (
        <CampaignList onSelectCampaign={handleSelectCampaign} />
      )}

      {view === 'dashboard' && selectedCampaignId && (
        <CampaignDashboard
          campaignId={selectedCampaignId}
          onBack={handleBackToCampaigns}
          onEnterMap={handleEnterMap}
        />
      )}

      {view === 'map' && (
        <>
          <MapView />
          <button
            type="button"
            onClick={handleBackFromMap}
            className="fixed top-3 left-3 z-50 px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-800/80 hover:bg-gray-700/90 border border-gray-600 rounded transition-colors"
          >
            &larr; Back
          </button>
        </>
      )}

      {/* Sign Out button -- always visible */}
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
 * login/signup pages; authenticated users see the campaign flow.
 */
function App() {
  return (
    <AuthGuard>
      <AppContent />
    </AuthGuard>
  );
}

export default App;
