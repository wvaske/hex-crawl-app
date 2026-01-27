import { useState } from "react";
import { apiFetch } from "../../lib/api";

interface CreateCampaignDialogProps {
  onCreated: () => void;
  onClose: () => void;
}

export function CreateCampaignDialog({
  onCreated,
  onClose,
}: CreateCampaignDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiFetch("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        role="presentation"
      />

      {/* Dialog */}
      <div className="relative bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md border border-gray-700">
        <h2 className="text-xl font-bold text-gray-100 mb-4">
          Create Campaign
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-red-400 text-sm bg-red-900/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="campaign-name"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Campaign Name
            </label>
            <input
              id="campaign-name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-gray-700 text-gray-100 border border-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="Enter campaign name"
              autoFocus
            />
          </div>

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2 transition-colors"
            >
              {loading ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
