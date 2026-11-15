FROM golang:1.26.11-bookworm AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/daymark/ ./cmd/daymark/
COPY services/server/ ./services/server/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/daymark ./cmd/daymark

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 daymark \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin daymark \
    && mkdir /data \
    && chown 10001:10001 /data \
    && chmod 0700 /data

WORKDIR /app
COPY --from=build /out/daymark /app/daymark
COPY apps/web/ ./apps/web/

USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/app/daymark"]
