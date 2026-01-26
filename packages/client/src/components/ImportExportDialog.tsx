import { useRef, useState } from 'react';
import { useMapStore } from '../stores/useMapStore';
import { useUIStore } from '../stores/useUIStore';
import { exportMap, importMap } from '../hex/import-export';

/**
 * UI for JSON map file export (download) and import (upload).
 *
 * Export: reads current map from store, serializes to JSON, triggers download.
 * Import: file picker accepting .json, validates with Zod, loads into store.
 * Error handling: displays Zod validation errors clearly without crashing.
 */
export function ImportExportDialog() {
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasMap = useMapStore((s) => s.hexes.size > 0);
  const mapName = useMapStore((s) => s.mapName);

  /** Export the current map as a downloadable JSON file */
  function handleExport() {
    const state = useMapStore.getState();
    const jsonString = exportMap(state);

    // Create blob and trigger download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.mapName || 'hex-map'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setImportStatus({ type: 'success', message: 'Map exported successfully!' });
  }

  /** Process an imported file */
  function processFile(file: File) {
    setImportStatus(null);

    if (!file.name.endsWith('.json')) {
      setImportStatus({
        type: 'error',
        message: 'Please select a .json file.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const contents = event.target?.result as string;
      try {
        const result = importMap(contents);
        useMapStore.getState().initializeMap(
          result.name,
          result.gridWidth,
          result.gridHeight,
          result.hexes,
        );
        useUIStore.getState().setSidePanel('info');
        setImportStatus({
          type: 'success',
          message: `Imported "${result.name}" (${result.gridWidth}x${result.gridHeight}, ${result.hexes.size} hexes)`,
        });
      } catch (err) {
        setImportStatus({
          type: 'error',
          message: err instanceof Error ? err.message : 'Import failed',
        });
      }
    };
    reader.onerror = () => {
      setImportStatus({ type: 'error', message: 'Failed to read file.' });
    };
    reader.readAsText(file);
  }

  /** Handle file input change */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so the same file can be re-imported
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /** Handle drag and drop */
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  return (
    <div className="p-4 space-y-6">
      {/* Export section */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
          Export Map
        </h3>
        {hasMap ? (
          <>
            <p className="text-sm text-gray-400 mb-3">
              Download "{mapName}" as a JSON file.
            </p>
            <button
              onClick={handleExport}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-medium transition-colors"
            >
              Export Map
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-500 italic">
            No map to export. Create a map first.
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700" />

      {/* Import section */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
          Import Map
        </h3>
        <p className="text-sm text-gray-400 mb-3">
          Load a previously exported .json map file.
        </p>

        {/* Drag and drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
            ${
              isDragOver
                ? 'border-blue-400 bg-blue-400/10'
                : 'border-gray-600 hover:border-gray-500 bg-gray-700/30'
            }
          `}
          onClick={() => fileInputRef.current?.click()}
        >
          <p className="text-sm text-gray-400">
            {isDragOver ? 'Drop file here' : 'Click or drag a .json file here'}
          </p>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Status messages */}
      {importStatus && (
        <div
          className={`
            p-3 rounded-md text-sm
            ${
              importStatus.type === 'success'
                ? 'bg-green-900/50 text-green-300 border border-green-700'
                : 'bg-red-900/50 text-red-300 border border-red-700'
            }
          `}
        >
          <pre className="whitespace-pre-wrap font-mono text-xs">
            {importStatus.message}
          </pre>
        </div>
      )}

      {/* Info */}
      <div className="p-3 bg-gray-700/50 rounded-md">
        <p className="text-xs text-gray-400">
          Map files use JSON format with Zod schema validation.
          Exported files include version, grid dimensions, and all hex terrain data.
          Invalid files will show detailed error messages.
        </p>
      </div>
    </div>
  );
}
