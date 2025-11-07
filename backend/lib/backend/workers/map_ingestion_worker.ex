defmodule Backend.Workers.MapIngestionWorker do
  @moduledoc """
  Oban worker responsible for processing uploaded map assets. For now the
  worker simply simulates progress events; wire up actual tiling logic
  later using libvips or similar tooling.
  """

  use Oban.Worker, queue: :ingestion, max_attempts: 3

  alias Backend.Events

  @impl true
  def perform(%Oban.Job{args: %{"map_id" => map_id, "campaign_id" => campaign_id}}) do
    :timer.sleep(100)
    Events.broadcast_campaign(campaign_id, {:map_processing_started, %{map_id: map_id}})
    :timer.sleep(100)

    Events.broadcast_campaign(
      campaign_id,
      {:map_processing_progress, %{map_id: map_id, progress: 0.5}}
    )

    :timer.sleep(100)
    Events.broadcast_campaign(campaign_id, {:map_processing_complete, %{map_id: map_id}})
    :ok
  end
end
