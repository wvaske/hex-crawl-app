defmodule Backend.Campaigns.Models.Campaign do
  @enforce_keys [:id, :name, :description, :maps, :default_hex_size]
  @derive {Jason.Encoder,
           only: [:id, :name, :description, :maps, :default_hex_size, :members, :share_links]}
  defstruct @enforce_keys ++ [members: [], share_links: []]
end

defmodule Backend.Campaigns.Models.Map do
  @enforce_keys [
    :id,
    :campaign_id,
    :name,
    :hex_size_px,
    :scale_ratio,
    :tileset_path,
    :bounds,
    :child_maps,
    :explored_hexes,
    :current_player_hex
  ]
  @derive {Jason.Encoder,
           only: [
             :id,
             :campaign_id,
             :name,
             :hex_size_px,
             :scale_ratio,
             :tileset_path,
             :bounds,
             :child_maps,
             :explored_hexes,
             :current_player_hex,
             :parent_map_id,
             :parent_region
           ]}
  defstruct @enforce_keys ++ [parent_map_id: nil, parent_region: nil]
end

defmodule Backend.Campaigns.Models.Hex do
  @enforce_keys [:id, :map_id, :q, :r, :terrain]
  @derive {Jason.Encoder, only: [:id, :map_id, :q, :r, :terrain, :notes]}
  defstruct @enforce_keys ++ [notes: nil]
end

defmodule Backend.Campaigns.Models.HexItem do
  @enforce_keys [:id, :hex_id, :map_id, :name, :description, :visibility_distance]
  @derive {Jason.Encoder,
           only: [
             :id,
             :hex_id,
             :map_id,
             :name,
             :description,
             :visibility_distance,
             :icon,
             :always_visible
           ]}
  defstruct @enforce_keys ++ [icon: nil, always_visible: false]
end

defmodule Backend.Campaigns.Models.ExplorationEvent do
  @enforce_keys [:id, :map_id, :campaign_id, :type, :occurred_at, :payload]
  @derive {Jason.Encoder, only: [:id, :map_id, :campaign_id, :type, :occurred_at, :payload]}
  defstruct @enforce_keys
end

defmodule Backend.Campaigns.Models.PlayerLink do
  @enforce_keys [:id, :campaign_id, :token, :expires_at, :created_by]
  @derive {Jason.Encoder, only: [:id, :campaign_id, :token, :expires_at, :created_by, :label]}
  defstruct @enforce_keys ++ [label: nil]
end
