defmodule Backend.Application do
  @moduledoc """
  Bootstraps the Hex Crawl backend application, wiring together the
  database repo, realtime pubsub, in-memory state agent, Oban queues,
  and the Phoenix web endpoint.
  """

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      Backend.Repo,
      Backend.State,
      {Phoenix.PubSub, name: Backend.PubSub},
      BackendWeb.Telemetry,
      {Oban, Application.fetch_env!(:backend, Oban)},
      BackendWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Backend.Supervisor]

    with {:ok, pid} = result <- Supervisor.start_link(children, opts) do
      :ok = Backend.State.seed_demo_data()
      result
    end
  end

  @impl true
  def config_change(changed, _new, removed) do
    BackendWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
