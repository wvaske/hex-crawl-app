defmodule BackendWeb.Router do
  use BackendWeb, :router

  pipeline :api do
    plug(:accepts, ["json"])
  end

  scope "/api" do
    pipe_through(:api)

    forward("/graphql", Absinthe.Plug, schema: BackendWeb.Schema)

    forward("/graphiql", Absinthe.Plug.GraphiQL,
      schema: BackendWeb.Schema,
      interface: :playground
    )
  end
end
