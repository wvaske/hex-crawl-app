defmodule BackendWeb.Resolvers.CampaignResolver do
  @moduledoc false

  alias Backend.Campaigns

  def list_campaigns(_parent, _args, _resolution) do
    {:ok, Campaigns.list_campaigns()}
  end

  def campaign(_parent, %{id: id}, _resolution) do
    case Campaigns.get_campaign(id) do
      nil -> {:error, "Campaign not found"}
      campaign -> {:ok, campaign}
    end
  end

  def map(_parent, %{id: id}, _resolution) do
    case Campaigns.get_campaign_for_map(id) do
      nil -> {:error, "Map not found"}
      map -> {:ok, map}
    end
  end

  def exploration_history(_parent, args, _resolution) do
    map_id = args[:map_id]
    limit = Map.get(args, :limit, 20)
    cursor = Map.get(args, :cursor)
    {:ok, Campaigns.exploration_history(map_id, limit: limit, cursor: cursor)}
  end

  def set_player_location(_parent, %{map_id: map_id, q: q, r: r}, _resolution) do
    case Campaigns.set_player_location(map_id, {q, r}) do
      {:ok, map} -> {:ok, map}
      {:error, reason} -> {:error, "Failed to set player location: #{inspect(reason)}"}
    end
  end

  def reveal_hexes(_parent, %{map_id: map_id, hexes: hexes}, _resolution) do
    coords = Enum.map(hexes, fn %{q: q, r: r} -> {q, r} end)

    case Campaigns.reveal_hexes(map_id, coords) do
      {:ok, map} -> {:ok, map}
      {:error, reason} -> {:error, "Failed to reveal hexes: #{inspect(reason)}"}
    end
  end

  def create_hex_item(_parent, %{map_id: map_id, hex: %{q: q, r: r}} = args, _res) do
    attrs = Map.take(args, [:name, :description, :icon, :visibility_distance, :always_visible])

    case Campaigns.create_hex_item(map_id, {q, r}, attrs) do
      {:ok, item} -> {:ok, item}
      {:error, reason} -> {:error, "Failed to create item: #{inspect(reason)}"}
    end
  end

  def update_hex_item(_parent, %{map_id: map_id, hex: %{q: q, r: r}, id: id} = args, _res) do
    attrs = Map.take(args, [:name, :description, :icon, :visibility_distance, :always_visible])

    case Campaigns.update_hex_item(map_id, {q, r}, id, attrs) do
      {:ok, item} -> {:ok, item}
      {:error, reason} -> {:error, "Failed to update item: #{inspect(reason)}"}
    end
  end

  def delete_hex_item(_parent, %{map_id: map_id, hex: %{q: q, r: r}, id: id}, _res) do
    case Campaigns.delete_hex_item(map_id, {q, r}, id) do
      {:ok, item} -> {:ok, item}
      {:error, reason} -> {:error, "Failed to delete item: #{inspect(reason)}"}
    end
  end
end
