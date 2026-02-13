import Config

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise "DATABASE_URL environment variable is missing."

  config :backend, Backend.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE", "10"))

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise "SECRET_KEY_BASE is missing"

  config :backend, BackendWeb.Endpoint,
    url: [host: System.get_env("PHX_HOST", "example.com"), port: 443],
    http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT", "4000"))],
    secret_key_base: secret_key_base

  config :backend, Backend.Auth.Guardian,
    secret_key:
      System.get_env("GUARDIAN_SECRET") ||
        raise("GUARDIAN_SECRET not provided")
end
