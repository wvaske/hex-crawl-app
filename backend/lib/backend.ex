defmodule Backend do
  @moduledoc """
  Entry point providing convenience accessors for the different contexts
  that power the hex crawl experience (campaigns, storage, history).
  """

  alias Backend.Campaigns

  defdelegate list_campaigns(opts \\ []), to: Campaigns, as: :list_campaigns
  defdelegate get_campaign(id), to: Campaigns, as: :get_campaign
  defdelegate create_campaign(attrs), to: Campaigns, as: :create_campaign
  defdelegate upsert_map(campaign_id, attrs), to: Campaigns, as: :upsert_map
  defdelegate set_player_location(map_id, coords), to: Campaigns
  defdelegate reveal_hexes(map_id, hex_ids, opts \\ []), to: Campaigns
  defdelegate conceal_hexes(map_id, hex_ids), to: Campaigns
  defdelegate create_hex_item(map_id, hex_id, attrs), to: Campaigns
  defdelegate update_hex_item(map_id, hex_id, item_id, attrs), to: Campaigns
  defdelegate delete_hex_item(map_id, hex_id, item_id), to: Campaigns
  defdelegate exploration_history(map_id, opts \\ []), to: Campaigns
end
