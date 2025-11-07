defmodule Backend.Auth.Guardian do
  @moduledoc """
  Guardian implementation that issues JWT tokens for authenticated
  Dungeon Masters. The current implementation simply uses the user ID as
  the subject; integration with a full user database can be added later.
  """

  use Guardian, otp_app: :backend

  @impl Guardian
  def subject_for_token(%{id: id}, _claims), do: {:ok, to_string(id)}

  def subject_for_token(id, _claims) when is_binary(id), do: {:ok, id}
  def subject_for_token(_, _), do: {:error, :unknown_resource}

  @impl Guardian
  def resource_from_claims(%{"sub" => id}), do: {:ok, %{id: id}}
  def resource_from_claims(_), do: {:error, :unknown_resource}
end
