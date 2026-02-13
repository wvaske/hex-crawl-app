defmodule BackendWeb do
  @moduledoc """
  Entry point for defining the web interface components such as
  controllers, channels, and GraphQL schema helpers.
  """

  def controller do
    quote do
      use Phoenix.Controller, namespace: BackendWeb
      import Plug.Conn
      alias BackendWeb.Router.Helpers, as: Routes
    end
  end

  def channel do
    quote do
      use Phoenix.Channel
    end
  end

  def schema do
    quote do
      use Absinthe.Schema
      import_types(Absinthe.Type.Custom)
    end
  end

  def view do
    quote do
      use Phoenix.View,
        root: "lib/backend_web/templates",
        namespace: BackendWeb

      import Phoenix.Controller, only: [get_flash: 1, get_flash: 2, view_module: 1]
      alias BackendWeb.Router.Helpers, as: Routes
    end
  end

  def router do
    quote do
      use Phoenix.Router
      import Plug.Conn
      import Phoenix.Controller
    end
  end

  defmacro __using__(which) when is_atom(which) do
    apply(__MODULE__, which, [])
  end
end
