export type HexCoords = { q: number; r: number };

export type HexItem = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  visibility_distance: number;
  always_visible: boolean;
  hex_id: string;
};

export type MapSummary = {
  id: string;
  name: string;
  hex_size_px: number;
  scale_ratio: number;
  tileset_path: string;
  explored_hexes: HexCoords[];
  current_player_hex?: HexCoords | null;
};

export type CampaignSummary = {
  id: string;
  name: string;
  description?: string;
  default_hex_size: number;
  maps: MapSummary[];
  share_links: PlayerLink[];
};

export type PlayerLink = {
  id: string;
  token: string;
  label?: string | null;
  expires_at: string;
};

export type MapDetail = MapSummary & {
  bounds: { min_q: number; max_q: number; min_r: number; max_r: number };
  items: HexItem[];
  campaign: { id: string; name: string };
};

export type ExplorationEvent = {
  id: string;
  type: string;
  occurred_at: string;
  payload: string;
};
