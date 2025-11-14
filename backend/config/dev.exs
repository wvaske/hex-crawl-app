import Config

config :backend, Backend.Repo,
  database: "hex_crawl_dev",
  username: "postgres",
  password: "postgres",
  hostname: System.get_env("POSTGRES_HOST", "localhost"),
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :backend, BackendWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT", "4000"))],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "dev_secret_key_base",
  watchers: []

config :backend, :storage,
  bucket: System.get_env("STORAGE_BUCKET", "hexcrawl"),
  endpoint: System.get_env("STORAGE_ENDPOINT", "http://localhost:9000"),
  access_key_id: System.get_env("STORAGE_ACCESS_KEY", "minioadmin"),
  secret_access_key: System.get_env("STORAGE_SECRET_KEY", "minioadmin"),
  region: System.get_env("STORAGE_REGION", "us-east-1"),
  scheme: :http
