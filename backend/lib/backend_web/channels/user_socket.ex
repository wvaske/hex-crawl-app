defmodule BackendWeb.UserSocket do
  use Phoenix.Socket

  channel("campaign:*", BackendWeb.CampaignChannel)
  channel("map:*", BackendWeb.MapChannel)

  def connect(%{"token" => token}, socket, _connect_info) do
    {:ok, assign(socket, :token, token)}
  end

  def connect(_params, _socket, _connect_info), do: :error

  def id(socket), do: "players:" <> socket.assigns.token
end
