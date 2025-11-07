defmodule BackendWeb.Schema do
  use BackendWeb, :schema

  alias BackendWeb.Resolvers.CampaignResolver

  import_types(BackendWeb.Schema.Types.CampaignTypes)

  query do
    field :campaigns, list_of(:campaign) do
      resolve(&CampaignResolver.list_campaigns/3)
    end

    field :campaign, :campaign do
      arg(:id, non_null(:id))
      resolve(&CampaignResolver.campaign/3)
    end

    field :map, :map do
      arg(:id, non_null(:id))
      resolve(&CampaignResolver.map/3)
    end

    field :exploration_history, list_of(:exploration_event) do
      arg(:map_id, non_null(:id))
      arg(:limit, :integer)
      arg(:cursor, :id)
      resolve(&CampaignResolver.exploration_history/3)
    end
  end

  mutation do
    field :set_player_location, :map do
      arg(:map_id, non_null(:id))
      arg(:q, non_null(:integer))
      arg(:r, non_null(:integer))
      resolve(&CampaignResolver.set_player_location/3)
    end

    field :reveal_hexes, :map do
      arg(:map_id, non_null(:id))
      arg(:hexes, non_null(list_of(:hex_coords_input)))
      resolve(&CampaignResolver.reveal_hexes/3)
    end

    field :create_hex_item, :hex_item do
      arg(:map_id, non_null(:id))
      arg(:hex, non_null(:hex_coords_input))
      arg(:name, non_null(:string))
      arg(:description, :string)
      arg(:icon, :string)
      arg(:visibility_distance, :integer)
      arg(:always_visible, :boolean)
      resolve(&CampaignResolver.create_hex_item/3)
    end

    field :update_hex_item, :hex_item do
      arg(:map_id, non_null(:id))
      arg(:hex, non_null(:hex_coords_input))
      arg(:id, non_null(:id))
      arg(:name, :string)
      arg(:description, :string)
      arg(:icon, :string)
      arg(:visibility_distance, :integer)
      arg(:always_visible, :boolean)
      resolve(&CampaignResolver.update_hex_item/3)
    end

    field :delete_hex_item, :hex_item do
      arg(:map_id, non_null(:id))
      arg(:hex, non_null(:hex_coords_input))
      arg(:id, non_null(:id))
      resolve(&CampaignResolver.delete_hex_item/3)
    end
  end
end
