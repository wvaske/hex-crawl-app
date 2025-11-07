defmodule BackendWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :backend

  socket("/socket", BackendWeb.UserSocket,
    websocket: true,
    longpoll: false
  )

  plug(Plug.RequestId)
  plug(Plug.Telemetry, event_prefix: [:phoenix, :endpoint])

  plug(Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()
  )

  plug(Plug.MethodOverride)
  plug(Plug.Head)
  plug(Plug.Session, store: :cookie, key: "_backend_key", signing_salt: "hexcrawl")

  plug(BackendWeb.Router)
end
