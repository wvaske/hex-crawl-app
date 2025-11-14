import Config

config :backend,
  ecto_repos: [Backend.Repo]

config :backend, BackendWeb.Endpoint,
  url: [host: "localhost"],
  render_errors: [view: BackendWeb.ErrorView, accepts: ~w(json), layout: false],
  pubsub_server: Backend.PubSub,
  live_view: [signing_salt: "hexcrawl"]

config :backend, BackendWeb.Endpoint, secret_key_base: "AReallyLongSecretKeyBaseForDevOnly"

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

config :backend, Oban,
  repo: Backend.Repo,
  queues: [default: 10, ingestion: 5],
  plugins: [Oban.Plugins.Pruner]

config :backend, Backend.Auth.Guardian,
  issuer: "hex_crawl",
  secret_key: "super_secret_key_change_me"

import_config "#{config_env()}.exs"
