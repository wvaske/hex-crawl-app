import { useEffect } from 'react';
import { MapView } from './components/MapView';
import { useMapStore } from './stores/useMapStore';
import { useUIStore } from './stores/useUIStore';

/**
 * App root component.
 *
 * On initial load, if no map exists, switches the side panel
 * to the Create tab so the user can generate a new map.
 * Once a map is created, the canvas shows the generated terrain grid.
 */
function App() {
  const hexCount = useMapStore((s) => s.hexes.size);
  const setSidePanel = useUIStore((s) => s.setSidePanel);

  // On first load with no map, show the Create tab
  useEffect(() => {
    if (hexCount === 0) {
      setSidePanel('create');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only on mount

  return <MapView />;
}

export default App;
