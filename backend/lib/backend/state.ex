defmodule Backend.State do
  @moduledoc """
  Holds a lightweight in-memory representation of campaigns and their
  maps so that the prototype can operate without a full database. The
  structure mirrors the relational schema so it can be replaced by real
  persistence later.
  """

  use Agent

  alias Backend.Campaigns.Models.{Campaign, Hex, HexItem, ExplorationEvent}
  alias Backend.Campaigns.Models.Map, as: CampaignMap

  def start_link(_opts) do
    Agent.start_link(fn -> %{campaigns: %{}, maps: %{}, hexes: %{}, items: %{}, events: []} end,
      name: __MODULE__
    )
  end

  def transaction(fun) when is_function(fun, 1) do
    Agent.get_and_update(__MODULE__, fn state ->
      {result, new_state} = fun.(state)
      {result, new_state}
    end)
  end

  def read(fun) when is_function(fun, 1) do
    Agent.get(__MODULE__, fun)
  end

  def seed_demo_data do
    transaction(fn state ->
      if map_size(state.campaigns) > 0 do
        {:ok, state}
      else
        campaign = %Campaign{
          id: "cmp-1",
          name: "Isles of Meridia",
          description: "Sample campaign showcasing continent and region maps",
          default_hex_size: 24,
          maps: ["map-continent", "map-region"]
        }

        continent = %CampaignMap{
          id: "map-continent",
          campaign_id: campaign.id,
          name: "Continent of Meridia",
          hex_size_px: 64,
          scale_ratio: 1.0,
          parent_map_id: nil,
          parent_region: nil,
          tileset_path: "tiles/continent",
          bounds: %{min_q: 0, max_q: 100, min_r: 0, max_r: 100},
          explored_hexes: MapSet.new(),
          current_player_hex: nil,
          child_maps: [%{map_id: "map-region", region: %{q: 10..30, r: 10..30}}]
        }

        region = %CampaignMap{
          id: "map-region",
          campaign_id: campaign.id,
          name: "Meridia Heartlands",
          hex_size_px: 128,
          scale_ratio: 0.125,
          parent_map_id: "map-continent",
          parent_region: %{min_q: 10, max_q: 30, min_r: 10, max_r: 30},
          tileset_path: "tiles/region",
          bounds: %{min_q: 0, max_q: 120, min_r: 0, max_r: 120},
          explored_hexes: MapSet.new(),
          current_player_hex: {12, 18},
          child_maps: []
        }

        sample_hexes =
          for q <- 0..20, r <- 0..20, into: %{} do
            key = {region.id, q, r}

            hex = %Hex{
              id: "#{q}:#{r}",
              map_id: region.id,
              q: q,
              r: r,
              terrain: if(rem(q + r, 5) == 0, do: "forest", else: "plains"),
              notes: nil
            }

            {key, hex}
          end

        sample_items = %{
          {region.id, "10:12", "itm-1"} => %HexItem{
            id: "itm-1",
            hex_id: "10:12",
            map_id: region.id,
            name: "Ruined Tower",
            description: "Crumbling watchtower haunted by specters",
            icon: "icons/tower.svg",
            visibility_distance: 2,
            always_visible: false
          }
        }

        events = [
          %ExplorationEvent{
            id: "evt-1",
            map_id: region.id,
            campaign_id: campaign.id,
            type: :move_players,
            occurred_at: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_naive(),
            payload: %{q: 12, r: 18, reason: "Session start"}
          }
        ]

        new_state =
          state
          |> put_in([:campaigns, campaign.id], campaign)
          |> put_in([:maps, continent.id], continent)
          |> put_in([:maps, region.id], region)
          |> Map.update!(:hexes, &Map.merge(&1, sample_hexes))
          |> Map.update!(:items, &Map.merge(&1, sample_items))
          |> Map.put(:events, events)

        {{:ok, campaign}, new_state}
      end
    end)
    |> case do
      {:ok, _} -> :ok
      other -> other
    end
  end
end
