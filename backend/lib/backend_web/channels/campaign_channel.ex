defmodule BackendWeb.CampaignChannel do
  use BackendWeb, :channel

  alias Backend.Campaigns

  @impl true
  def join("campaign:" <> campaign_id = topic, _params, socket) do
    Phoenix.PubSub.subscribe(Backend.PubSub, topic)
    {:ok, assign(socket, :campaign_id, campaign_id)}
  end

  @impl true
  def handle_in("generate_player_link", params, socket) do
    campaign_id = socket.assigns.campaign_id

    case Campaigns.generate_player_link(campaign_id, params) do
      {:ok, link} ->
        {:reply, {:ok, %{link: link}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  @impl true
  def handle_info({:history_event, event}, socket) do
    push(socket, "history_event", event)
    {:noreply, socket}
  end

  def handle_info({:map_upserted, map}, socket) do
    push(socket, "map_upserted", map)
    {:noreply, socket}
  end

  def handle_info({:player_link_created, link}, socket) do
    push(socket, "player_link_created", link)
    {:noreply, socket}
  end

  def handle_info({event, payload}, socket) do
    push(socket, to_string(event), payload)
    {:noreply, socket}
  end
end
