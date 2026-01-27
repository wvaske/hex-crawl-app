import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface PendingInvitation {
  id: string;
  campaignId: string;
  campaignName: string;
  invitedBy: string;
  createdAt: string;
}

interface PendingInvitationsProps {
  onAccepted: () => void;
}

export function PendingInvitations({ onAccepted }: PendingInvitationsProps) {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchInvitations = async () => {
    try {
      const data = await apiFetch<{ invitations: PendingInvitation[] }>(
        "/api/invitations/pending"
      );
      setInvitations(data.invitations);
    } catch (err) {
      console.error("Failed to fetch invitations:", err);
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, []);

  const handleAccept = async (id: string) => {
    setProcessing(id);
    try {
      await apiFetch(`/api/invitations/${id}/accept`, { method: "POST" });
      setInvitations((prev) => prev.filter((inv) => inv.id !== id));
      onAccepted();
    } catch (err) {
      console.error("Failed to accept invitation:", err);
    } finally {
      setProcessing(null);
    }
  };

  const handleDecline = async (id: string) => {
    setProcessing(id);
    try {
      await apiFetch(`/api/invitations/${id}/decline`, { method: "POST" });
      setInvitations((prev) => prev.filter((inv) => inv.id !== id));
    } catch (err) {
      console.error("Failed to decline invitation:", err);
    } finally {
      setProcessing(null);
    }
  };

  if (invitations.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Pending Invitations
      </h2>
      <div className="space-y-3">
        {invitations.map((inv) => (
          <div
            key={inv.id}
            className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-4 flex items-center justify-between"
          >
            <div>
              <p className="text-gray-100 font-medium">{inv.campaignName}</p>
              <p className="text-sm text-gray-400">
                Invited {new Date(inv.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleAccept(inv.id)}
                disabled={processing === inv.id}
                className="bg-green-700 hover:bg-green-600 disabled:bg-green-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded px-3 py-1.5 transition-colors"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => handleDecline(inv.id)}
                disabled={processing === inv.id}
                className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-gray-300 text-sm font-medium rounded px-3 py-1.5 transition-colors"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
