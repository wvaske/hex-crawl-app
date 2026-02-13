FROM hexpm/elixir:1.15.7-erlang-26.1.2-debian-bullseye-20240130 AS build

ENV MIX_ENV=prod
WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs mix.exs
COPY config config
RUN mix deps.get --only prod

COPY lib lib
COPY priv priv

RUN mix compile

FROM debian:bullseye-slim AS app

RUN apt-get update && apt-get install -y openssl ncurses-libs && rm -rf /var/lib/apt/lists/*

ENV MIX_ENV=prod
WORKDIR /app

COPY --from=build /root/.cache/ /root/.cache/
COPY --from=build /root/.mix/ /root/.mix/
COPY --from=build /app /app

EXPOSE 4000
CMD ["mix", "phx.server"]
