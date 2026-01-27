import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { CreateCampaignDialog } from "./CreateCampaignDialog";
import { PendingInvitations } from "./PendingInvitations";

interface Campaign {
  id: string;
  name: string;
  ownerId: string;
  role: "dm" | "player";
  createdAt: string;
}

interface CampaignListProps {
  onSelectCampaign: (campaignId: string) => void;
}

export function CampaignList({ onSelectCampaign }: CampaignListProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchCampaigns = async () => {
    try {
      const data = await apiFetch<{ campaigns: Campaign[] }>("/api/campaigns");
      setCampaigns(data.campaigns);
    } catch (err) {
      console.error("Failed to fetch campaigns:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const handleCreated = () => {
    setShowCreate(false);
    fetchCampaigns();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-gray-400 text-lg">Loading campaigns...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">My Campaigns</h1>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium rounded px-4 py-2 transition-colors"
          >
            Create Campaign
          </button>
        </div>

        {/* Pending invitations banner */}
        <PendingInvitations onAccepted={fetchCampaigns} />

        {campaigns.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-lg mb-2">No campaigns yet</p>
            <p className="text-gray-500 text-sm">
              Create a campaign to get started as a DM, or wait for an
              invitation from another DM.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {campaigns.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectCampaign(c.id)}
                className="bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-lg p-4 text-left transition-colors w-full"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-100">
                    {c.name}
                  </h2>
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      c.role === "dm"
                        ? "bg-blue-900/50 text-blue-300 border border-blue-700"
                        : "bg-green-900/50 text-green-300 border border-green-700"
                    }`}
                  >
                    {c.role === "dm" ? "DM" : "Player"}
                  </span>
                </div>
                <p className="text-sm text-gray-400 mt-1">
                  Created {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </button>
            ))}
          </div>
        )}

        {showCreate && (
          <CreateCampaignDialog
            onCreated={handleCreated}
            onClose={() => setShowCreate(false)}
          />
        )}
      </div>
    </div>
  );
}
