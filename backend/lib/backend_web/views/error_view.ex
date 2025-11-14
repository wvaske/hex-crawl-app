defmodule BackendWeb.ErrorView do
  use BackendWeb, :view

  def render("404.json", _assigns), do: %{error: %{message: "Not found"}}
  def render("500.json", _assigns), do: %{error: %{message: "Internal server error"}}
  def template_not_found(_template, assigns), do: render("500.json", assigns)
end
