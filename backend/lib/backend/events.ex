defmodule Backend.Events do
  @moduledoc """
  Helper utilities for publishing domain events to Phoenix PubSub topics.
  """

  def broadcast_campaign(campaign_id, payload) do
    Phoenix.PubSub.broadcast(Backend.PubSub, "campaign:" <> campaign_id, payload)
  end

  def broadcast_map(map_id, payload) do
    Phoenix.PubSub.broadcast(Backend.PubSub, "map:" <> map_id, payload)
  end
end
