defmodule BackendWeb.Schema.Types.CampaignTypes do
  @moduledoc false

  use Absinthe.Schema.Notation

  @desc "Arbitrary JSON value"
  scalar :json do
    serialize(& &1)
    parse(&parse_json/1)
  end

  object :campaign do
    field(:id, non_null(:id))
    field(:name, non_null(:string))
    field(:description, :string)
    field(:default_hex_size, non_null(:integer))
    field(:maps, list_of(:map))
    field(:share_links, list_of(:player_link))
  end

  object :map do
    field(:id, non_null(:id))
    field(:campaign_id, non_null(:id))
    field(:name, non_null(:string))
    field(:hex_size_px, non_null(:integer))
    field(:scale_ratio, non_null(:float))
    field(:tileset_path, non_null(:string))
    field(:bounds, non_null(:bounds))
    field(:parent_map_id, :id)
    field(:parent_region, :bounds)
    field(:child_maps, list_of(:child_map_link))
    field(:explored_hexes, list_of(:hex_coords))
    field(:current_player_hex, :hex_coords)
    field(:items, list_of(:hex_item))
    field(:campaign, :campaign)
  end

  object :child_map_link do
    field(:map_id, non_null(:id))
    field(:region, :bounds)
  end

  object :bounds do
    field(:min_q, non_null(:integer))
    field(:max_q, non_null(:integer))
    field(:min_r, non_null(:integer))
    field(:max_r, non_null(:integer))
  end

  object :hex do
    field(:id, non_null(:id))
    field(:map_id, non_null(:id))
    field(:q, non_null(:integer))
    field(:r, non_null(:integer))
    field(:terrain, non_null(:string))
    field(:notes, :string)
    field(:items, list_of(:hex_item))
  end

  object :hex_item do
    field(:id, non_null(:id))
    field(:map_id, non_null(:id))
    field(:hex_id, non_null(:string))
    field(:name, non_null(:string))
    field(:description, :string)
    field(:icon, :string)
    field(:visibility_distance, non_null(:integer))
    field(:always_visible, non_null(:boolean))
  end

  object :player_link do
    field(:id, non_null(:id))
    field(:token, non_null(:string))
    field(:label, :string)
    field(:expires_at, non_null(:naive_datetime))
    field(:created_by, :string)
  end

  object :exploration_event do
    field(:id, non_null(:id))
    field(:map_id, non_null(:id))
    field(:campaign_id, non_null(:id))
    field(:type, non_null(:string))
    field(:occurred_at, non_null(:naive_datetime))
    field(:payload, non_null(:json))
  end

  input_object :hex_coords_input do
    field(:q, non_null(:integer))
    field(:r, non_null(:integer))
  end

  object :hex_coords do
    field(:q, non_null(:integer))
    field(:r, non_null(:integer))
  end

  defp parse_json(%Absinthe.Blueprint.Input.String{value: value}) do
    case Jason.decode(value) do
      {:ok, decoded} -> {:ok, decoded}
      _ -> :error
    end
  end

  defp parse_json(%Absinthe.Blueprint.Input.Null{}), do: {:ok, nil}

  defp parse_json(%Absinthe.Blueprint.Input.Raw{value: value})
       when is_map(value) or is_list(value),
       do: {:ok, value}

  defp parse_json(%Absinthe.Blueprint.Input.Object{fields: fields}) do
    Enum.reduce_while(fields, {:ok, %{}}, fn %{name: name, input_value: input_value},
                                             {:ok, acc} ->
      case parse_json(input_value) do
        {:ok, value} -> {:cont, {:ok, Map.put(acc, name, value)}}
        :error -> {:halt, :error}
      end
    end)
    |> case do
      {:ok, map} -> {:ok, map}
      :error -> :error
    end
  end

  defp parse_json(%Absinthe.Blueprint.Input.List{items: items}) do
    items
    |> Enum.reduce_while({:ok, []}, fn item, {:ok, acc} ->
      case parse_json(item) do
        {:ok, value} -> {:cont, {:ok, [value | acc]}}
        :error -> {:halt, :error}
      end
    end)
    |> case do
      {:ok, values} -> {:ok, Enum.reverse(values)}
      :error -> :error
    end
  end

  defp parse_json(value) when is_map(value) or is_list(value), do: {:ok, value}
  defp parse_json(value), do: {:ok, value}
end
