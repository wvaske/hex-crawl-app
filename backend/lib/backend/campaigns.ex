defmodule Backend.Campaigns do
  @moduledoc """
  Business logic for campaigns, maps, hex exploration, and timeline
  tracking. The current implementation stores data in an in-memory Agent
  so that the prototype works out-of-the-box while matching the
  persistence model planned for PostgreSQL.
  """

  alias Backend.State
  alias Backend.Events
  alias Backend.Campaigns.Models.{Campaign, HexItem, ExplorationEvent, PlayerLink}
  alias Backend.Campaigns.Models.Map, as: CampaignMap

  @type hex_coords :: {integer(), integer()}

  @doc """
  Returns all campaigns in memory.
  """
  def list_campaigns(_opts \\ []) do
    State.read(fn %{campaigns: campaigns, maps: maps} ->
      campaigns
      |> Map.values()
      |> Enum.map(&enrich_campaign(&1, maps))
    end)
  end

  def get_campaign(id) do
    State.read(fn %{campaigns: campaigns, maps: maps} ->
      with %Campaign{} = campaign <- Map.get(campaigns, id) do
        enrich_campaign(campaign, maps)
      end
    end)
  end

  def get_campaign_for_map(id) do
    State.read(fn %{maps: maps, campaigns: campaigns, items: items} ->
      with %CampaignMap{} = map <- Map.get(maps, id),
           %Campaign{} = campaign <- Map.get(campaigns, map.campaign_id) do
        map_items =
          items
          |> Enum.filter(fn {{map_id, _hex_id, _id}, _item} -> map_id == map.id end)
          |> Enum.map(fn {_key, item} -> normalise_item(item) end)

        map
        |> maybe_normalise_map()
        |> Map.put(:campaign, Map.from_struct(campaign))
        |> Map.put(:items, map_items)
      end
    end)
  end

  defp enrich_campaign(%Campaign{} = campaign, maps) do
    campaign
    |> Map.from_struct()
    |> Map.put(
      :maps,
      Enum.map(campaign.maps, fn map_id -> maybe_normalise_map(Map.get(maps, map_id)) end)
    )
    |> Map.update(:share_links, [], fn links -> Enum.map(links, &Map.from_struct/1) end)
  end

  def create_campaign(attrs) do
    id = Map.get(attrs, :id, "cmp-#{System.unique_integer([:positive])}")

    campaign = %Campaign{
      id: id,
      name: Map.fetch!(attrs, :name),
      description: Map.get(attrs, :description, ""),
      default_hex_size: Map.get(attrs, :default_hex_size, 6),
      maps: []
    }

    State.transaction(fn state ->
      new_state = put_in(state, [:campaigns, campaign.id], campaign)
      {{:ok, Map.from_struct(campaign)}, new_state}
    end)
  end

  def upsert_map(campaign_id, attrs) do
    id = Map.get(attrs, :id, "map-#{System.unique_integer([:positive])}")

    map = %CampaignMap{
      id: id,
      campaign_id: campaign_id,
      name: Map.fetch!(attrs, :name),
      hex_size_px: Map.fetch!(attrs, :hex_size_px),
      scale_ratio: Map.get(attrs, :scale_ratio, 1.0),
      parent_map_id: Map.get(attrs, :parent_map_id),
      parent_region: Map.get(attrs, :parent_region),
      tileset_path: Map.fetch!(attrs, :tileset_path),
      bounds: Map.fetch!(attrs, :bounds),
      child_maps: Map.get(attrs, :child_maps, []),
      explored_hexes: MapSet.new(Map.get(attrs, :explored_hexes, [])),
      current_player_hex: Map.get(attrs, :current_player_hex)
    }

    State.transaction(fn state ->
      new_state =
        state
        |> put_in([:maps, map.id], map)
        |> update_in([:campaigns, campaign_id, :maps], fn maps ->
          maps = maps || []

          if map.id in maps do
            maps
          else
            maps ++ [map.id]
          end
        end)

      Events.broadcast_campaign(campaign_id, {:map_upserted, maybe_normalise_map(map)})
      {{:ok, maybe_normalise_map(map)}, new_state}
    end)
  end

  def set_player_location(map_id, {q, r} = coords) do
    State.transaction(fn state ->
      map = get_in(state, [:maps, map_id])

      updated = %{
        map
        | current_player_hex: coords,
          explored_hexes: MapSet.put(map.explored_hexes, coords)
      }

      state_with_map = put_in(state, [:maps, map_id], updated)

      {event, new_state} =
        record_event(state_with_map, map.campaign_id, map_id, :move_players, %{q: q, r: r})

      Events.broadcast_map(
        map_id,
        {:player_moved, %{coords: coords_to_map(coords), event: event}}
      )

      {{:ok, maybe_normalise_map(updated)}, new_state}
    end)
  end

  def reveal_hexes(map_id, coords_list, opts \\ []) do
    annotate? = Keyword.get(opts, :annotate_history, true)

    State.transaction(fn state ->
      map = get_in(state, [:maps, map_id])

      new_explored =
        Enum.reduce(coords_list, map.explored_hexes, fn coords, acc -> MapSet.put(acc, coords) end)

      updated = %{map | explored_hexes: new_explored}
      state_with_map = put_in(state, [:maps, map_id], updated)

      converted_hexes = Enum.map(coords_list, &coords_to_map/1)

      {event, new_state} =
        if annotate? do
          record_event(state_with_map, map.campaign_id, map_id, :reveal_hexes, %{
            hexes: converted_hexes
          })
        else
          {nil, state_with_map}
        end

      Events.broadcast_map(
        map_id,
        {:hexes_revealed, %{hexes: Enum.map(coords_list, &coords_to_map/1), event: event}}
      )

      {{:ok, maybe_normalise_map(updated)}, new_state}
    end)
  end

  def conceal_hexes(map_id, coords_list) do
    State.transaction(fn state ->
      map = get_in(state, [:maps, map_id])

      new_explored =
        Enum.reduce(coords_list, map.explored_hexes, fn coords, acc ->
          MapSet.delete(acc, coords)
        end)

      updated = %{map | explored_hexes: new_explored}
      new_state = put_in(state, [:maps, map_id], updated)

      Events.broadcast_map(
        map_id,
        {:hexes_concealed, %{hexes: Enum.map(coords_list, &coords_to_map/1)}}
      )

      {{:ok, maybe_normalise_map(updated)}, new_state}
    end)
  end

  def create_hex_item(map_id, {q, r}, attrs) do
    hex_id = "#{q}:#{r}"
    id = Map.get(attrs, :id, "itm-#{System.unique_integer([:positive])}")

    item = %HexItem{
      id: id,
      map_id: map_id,
      hex_id: hex_id,
      name: Map.fetch!(attrs, :name),
      description: Map.get(attrs, :description, ""),
      icon: Map.get(attrs, :icon),
      visibility_distance: Map.get(attrs, :visibility_distance, 1),
      always_visible: Map.get(attrs, :always_visible, false)
    }

    State.transaction(fn state ->
      key = {map_id, hex_id, item.id}
      new_state = put_in(state, [:items, key], item)
      normalised = normalise_item(item)

      Events.broadcast_map(
        map_id,
        {:hex_item_created, %{hex: coords_to_map({q, r}), item: normalised}}
      )

      {{:ok, normalised}, new_state}
    end)
  end

  def update_hex_item(map_id, {q, r}, id, attrs) do
    hex_id = "#{q}:#{r}"

    State.transaction(fn state ->
      key = {map_id, hex_id, id}

      case get_in(state, [:items, key]) do
        nil ->
          {{:error, :not_found}, state}

        item ->
          updated =
            item
            |> Map.merge(
              Map.take(attrs, [:name, :description, :icon, :visibility_distance, :always_visible])
            )

          new_state = put_in(state, [:items, key], updated)
          normalised = normalise_item(updated)

          Events.broadcast_map(
            map_id,
            {:hex_item_updated, %{hex: coords_to_map({q, r}), item: normalised}}
          )

          {{:ok, normalised}, new_state}
      end
    end)
  end

  def delete_hex_item(map_id, {q, r}, id) do
    hex_id = "#{q}:#{r}"

    State.transaction(fn state ->
      key = {map_id, hex_id, id}

      case get_in(state, [:items, key]) do
        nil ->
          {{:error, :not_found}, state}

        item ->
          new_state = update_in(state, [:items], &Map.delete(&1, key))
          normalised = normalise_item(item)

          Events.broadcast_map(
            map_id,
            {:hex_item_deleted, %{hex: coords_to_map({q, r}), item: normalised}}
          )

          {{:ok, normalised}, new_state}
      end
    end)
  end

  def exploration_history(map_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, 20)
    cursor = Keyword.get(opts, :cursor, nil)

    State.read(fn %{events: events} ->
      events
      |> Enum.filter(&(&1.map_id == map_id))
      |> Enum.sort_by(& &1.occurred_at, {:desc, DateTime})
      |> maybe_apply_cursor(cursor)
      |> Enum.take(limit)
    end)
  end

  def generate_player_link(campaign_id, attrs \\ %{}) do
    token = Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)
    id = Map.get(attrs, :id, "lnk-#{System.unique_integer([:positive])}")

    link = %PlayerLink{
      id: id,
      campaign_id: campaign_id,
      token: token,
      created_by: Map.get(attrs, :created_by, "system"),
      label: Map.get(attrs, :label),
      expires_at:
        Map.get(
          attrs,
          :expires_at,
          DateTime.utc_now()
          |> DateTime.add(86_400)
          |> DateTime.truncate(:second)
          |> DateTime.to_naive()
        )
    }

    State.transaction(fn state ->
      new_state =
        update_in(state, [:campaigns, campaign_id, :share_links], fn links ->
          links = links || []
          links ++ [link]
        end)

      normalised = Map.from_struct(link)
      Events.broadcast_campaign(campaign_id, {:player_link_created, normalised})
      {{:ok, normalised}, new_state}
    end)
  end

  def list_visible_items(map_id, {q, r}, distance) do
    coords = {q, r}

    State.read(fn %{items: items} ->
      items
      |> Enum.filter(fn
        {{item_map_id, _hex_id, _id}, item} ->
          item_map_id == map_id and item_visible?(item, coords, distance)
      end)
      |> Enum.map(fn {_key, item} -> normalise_item(item) end)
    end)
  end

  defp maybe_normalise_map(nil), do: nil

  defp maybe_normalise_map(%CampaignMap{} = map) do
    map
    |> Map.from_struct()
    |> Map.update(:explored_hexes, [], fn set -> Enum.map(set, &coords_to_map/1) end)
    |> Map.update(:current_player_hex, nil, &maybe_coords_to_map/1)
    |> Map.update(:bounds, %{}, &normalise_bounds/1)
    |> Map.update(:parent_region, nil, &normalise_bounds/1)
    |> Map.update(:child_maps, [], fn child_maps ->
      Enum.map(child_maps, fn child -> Map.update(child, :region, nil, &normalise_bounds/1) end)
    end)
  end

  defp item_visible?(%HexItem{always_visible: true}, _coords, _distance), do: true

  defp item_visible?(
         %HexItem{hex_id: hex_id, visibility_distance: max_distance},
         {q, r},
         :infinite
       ) do
    within_visibility?(hex_id, {q, r}, max_distance)
  end

  defp item_visible?(
         %HexItem{hex_id: hex_id, visibility_distance: max_distance},
         {q, r},
         distance
       ) do
    distance <= max_distance and within_visibility?(hex_id, {q, r}, max_distance)
  end

  defp within_visibility?(hex_id, {q, r}, max_distance) do
    [hex_q, hex_r] = hex_id |> String.split(":") |> Enum.map(&String.to_integer/1)
    axial_distance({hex_q, hex_r}, {q, r}) <= max_distance
  end

  defp axial_distance({q1, r1}, {q2, r2}) do
    s1 = -q1 - r1
    s2 = -q2 - r2

    Enum.max([abs(q1 - q2), abs(r1 - r2), abs(s1 - s2)])
  end

  defp record_event(state, campaign_id, map_id, type, payload) do
    payload_string = encode_payload(payload)

    event = %ExplorationEvent{
      id: "evt-#{System.unique_integer([:positive])}",
      campaign_id: campaign_id,
      map_id: map_id,
      type: type,
      occurred_at: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_naive(),
      payload: payload_string
    }

    _ = Events.broadcast_campaign(campaign_id, {:history_event, event})

    {event, update_in(state, [:events], fn events -> [event | events] end)}
  end

  defp encode_payload(payload) when is_binary(payload), do: payload
  defp encode_payload(payload), do: Jason.encode!(payload)

  defp maybe_apply_cursor(events, nil), do: events

  defp maybe_apply_cursor(events, cursor) do
    Enum.drop_while(events, fn event -> event.id != cursor end)
    |> case do
      [] -> events
      [_matched | rest] -> rest
    end
  end

  defp coords_to_map({q, r}), do: %{q: q, r: r}
  defp coords_to_map(%{q: q, r: r}), do: %{q: q, r: r}

  defp maybe_coords_to_map(nil), do: nil
  defp maybe_coords_to_map(coords), do: coords_to_map(coords)

  defp normalise_bounds(nil), do: nil

  defp normalise_bounds(%{min_q: _, max_q: _, min_r: _, max_r: _} = bounds), do: bounds

  defp normalise_bounds(%{q: %Range{} = q_range, r: %Range{} = r_range}) do
    %{min_q: q_range.first, max_q: q_range.last, min_r: r_range.first, max_r: r_range.last}
  end

  defp normalise_bounds(%{q: q_range, r: r_range})
       when is_struct(q_range, Range) and is_struct(r_range, Range) do
    %{min_q: q_range.first, max_q: q_range.last, min_r: r_range.first, max_r: r_range.last}
  end

  defp normalise_bounds(%{min_q: _, max_q: _, min_r: _, max_r: _} = bounds), do: bounds
  defp normalise_bounds(_), do: nil

  defp normalise_item(%HexItem{} = item), do: Map.from_struct(item)
  defp normalise_item(nil), do: nil
end
