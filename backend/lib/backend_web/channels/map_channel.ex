defmodule BackendWeb.MapChannel do
  use BackendWeb, :channel

  alias Backend.Campaigns

  @impl true
  def join("map:" <> map_id = topic, _params, socket) do
    Phoenix.PubSub.subscribe(Backend.PubSub, topic)
    {:ok, assign(socket, :map_id, map_id)}
  end

  @impl true
  def handle_in("set_player_location", %{"q" => q, "r" => r}, socket) do
    map_id = socket.assigns.map_id

    case Campaigns.set_player_location(map_id, {q, r}) do
      {:ok, map} ->
        {:reply, {:ok, %{map: map}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  def handle_in("reveal_hexes", %{"hexes" => hexes}, socket) do
    map_id = socket.assigns.map_id
    coords = Enum.map(hexes, fn %{"q" => q, "r" => r} -> {q, r} end)

    {:ok, _map} = Campaigns.reveal_hexes(map_id, coords)
    {:reply, {:ok, %{hexes: coords}}, socket}
  end

  @impl true
  def handle_info({:player_moved, payload}, socket) do
    push(socket, "player_moved", payload)
    {:noreply, socket}
  end

  def handle_info({:hexes_revealed, payload}, socket) do
    push(socket, "hexes_revealed", payload)
    {:noreply, socket}
  end

  def handle_info({:hexes_concealed, payload}, socket) do
    push(socket, "hexes_concealed", payload)
    {:noreply, socket}
  end

  def handle_info({:hex_item_created, payload}, socket) do
    push(socket, "hex_item_created", payload)
    {:noreply, socket}
  end

  def handle_info({:hex_item_updated, payload}, socket) do
    push(socket, "hex_item_updated", payload)
    {:noreply, socket}
  end

  def handle_info({:hex_item_deleted, payload}, socket) do
    push(socket, "hex_item_deleted", payload)
    {:noreply, socket}
  end

  def handle_info({event, payload}, socket) do
    push(socket, to_string(event), payload)
    {:noreply, socket}
  end
end
