import { useState } from "react";
import { apiFetch } from "../../lib/api";

interface InvitePlayerDialogProps {
  campaignId: string;
  onInvited: () => void;
  onClose: () => void;
}

export function InvitePlayerDialog({
  campaignId,
  onInvited,
  onClose,
}: InvitePlayerDialogProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      await apiFetch(`/api/campaigns/${campaignId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setSuccess(`Invitation sent to ${email.trim()}`);
      setEmail("");
      onInvited();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send invitation"
      );
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
          Invite Player
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-red-400 text-sm bg-red-900/30 rounded px-3 py-2">
              {error}
            </div>
          )}
          {success && (
            <div className="text-green-400 text-sm bg-green-900/30 rounded px-3 py-2">
              {success}
            </div>
          )}

          <div>
            <label
              htmlFor="invite-email"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Player Email
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded bg-gray-700 text-gray-100 border border-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="player@example.com"
              autoFocus
            />
          </div>

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-gray-100 transition-colors"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2 transition-colors"
            >
              {loading ? "Sending..." : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
