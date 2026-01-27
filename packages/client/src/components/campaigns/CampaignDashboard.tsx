import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { InvitePlayerDialog } from "./InvitePlayerDialog";

interface CampaignDetails {
  id: string;
  name: string;
  ownerId: string;
  role: "dm" | "player";
  createdAt: string;
}

interface Member {
  id: string;
  userId: string;
  role: "dm" | "player";
  joinedAt: string;
}

interface InvitationStatus {
  id: string;
  email: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

interface CampaignDashboardProps {
  campaignId: string;
  onBack: () => void;
  onEnterMap: () => void;
}

export function CampaignDashboard({
  campaignId,
  onBack,
  onEnterMap,
}: CampaignDashboardProps) {
  const [campaign, setCampaign] = useState<CampaignDetails | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<InvitationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  const isDM = campaign?.role === "dm";

  const fetchData = async () => {
    try {
      const [campaignData, membersData] = await Promise.all([
        apiFetch<CampaignDetails>(`/api/campaigns/${campaignId}`),
        apiFetch<{ members: Member[] }>(
          `/api/campaigns/${campaignId}/members`
        ),
      ]);
      setCampaign(campaignData);
      setMembers(membersData.members);

      // Only DMs can fetch invitation status
      if (campaignData.role === "dm") {
        try {
          const invData = await apiFetch<{ invitations: InvitationStatus[] }>(
            `/api/campaigns/${campaignId}/invitations`
          );
          setInvitations(invData.invitations);
        } catch {
          // Player role -- silently ignore 403
        }
      }
    } catch (err) {
      console.error("Failed to fetch campaign data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInvited = () => {
    fetchData();
  };

  if (loading || !campaign) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-gray-400 text-lg">Loading campaign...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors mb-4 inline-flex items-center gap-1"
          >
            &larr; Back to Campaigns
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{campaign.name}</h1>
              <span
                className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                  isDM
                    ? "bg-blue-900/50 text-blue-300 border border-blue-700"
                    : "bg-green-900/50 text-green-300 border border-green-700"
                }`}
              >
                {isDM ? "DM" : "Player"}
              </span>
            </div>

            <div className="flex gap-3">
              {isDM && (
                <button
                  type="button"
                  onClick={() => setShowInvite(true)}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-100 font-medium rounded px-4 py-2 transition-colors"
                >
                  Invite Player
                </button>
              )}
              <button
                type="button"
                onClick={onEnterMap}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium rounded px-4 py-2 transition-colors"
              >
                Enter Map
              </button>
            </div>
          </div>

          <p className="text-sm text-gray-400 mt-2">
            Created {new Date(campaign.createdAt).toLocaleDateString()}
          </p>
        </div>

        {/* Members */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Members ({members.length})
          </h2>
          <div className="bg-gray-800 border border-gray-700 rounded-lg divide-y divide-gray-700">
            {members.map((m) => (
              <div key={m.id} className="px-4 py-3 flex items-center justify-between">
                <span className="text-gray-200">
                  {m.userId === campaign.ownerId ? "Campaign Owner" : `Player`}
                </span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    m.role === "dm"
                      ? "bg-blue-900/50 text-blue-300 border border-blue-700"
                      : "bg-green-900/50 text-green-300 border border-green-700"
                  }`}
                >
                  {m.role === "dm" ? "DM" : "Player"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Invitation Status (DM only) */}
        {isDM && invitations.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Invitations ({invitations.length})
            </h2>
            <div className="bg-gray-800 border border-gray-700 rounded-lg divide-y divide-gray-700">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <span className="text-gray-200">{inv.email}</span>
                    <span className="text-gray-500 text-sm ml-2">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      inv.status === "pending"
                        ? "bg-amber-900/50 text-amber-300 border border-amber-700"
                        : inv.status === "accepted"
                          ? "bg-green-900/50 text-green-300 border border-green-700"
                          : "bg-red-900/50 text-red-300 border border-red-700"
                    }`}
                  >
                    {inv.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {showInvite && (
          <InvitePlayerDialog
            campaignId={campaignId}
            onInvited={handleInvited}
            onClose={() => setShowInvite(false)}
          />
        )}
      </div>
    </div>
  );
}
