defmodule Backend.Storage do
  @moduledoc """
  Lightweight abstraction for generating pre-signed upload URLs. In this
  prototype the URLs are synthetic; integrate with ExAws or other SDKs
  when moving to production.
  """

  @spec presign_upload(String.t(), keyword()) :: %{url: String.t(), fields: map()}
  def presign_upload(path, opts \\ []) do
    bucket = Application.fetch_env!(:backend, :storage)[:bucket]
    endpoint = Application.fetch_env!(:backend, :storage)[:endpoint]
    expires_in = Keyword.get(opts, :expires_in, 3_600)

    %{
      url: Path.join(endpoint, Path.join(bucket, path)),
      fields: %{expires_in: expires_in}
    }
  end
end
