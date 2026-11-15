FROM golang:1.26.11-bookworm AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/tasks/ ./cmd/tasks/
COPY services/server/ ./services/server/
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/everyonesoftware/tasks/services/server.Version=${VERSION}" -o /out/tasks ./cmd/tasks

FROM debian:bookworm-slim

ARG VERSION=dev
LABEL org.opencontainers.image.title="Tasks" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.source="https://github.com/everyonesoftware/tasks"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 tasks \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin tasks \
    && mkdir /data \
    && chown 10001:10001 /data \
    && chmod 0700 /data

WORKDIR /app
COPY --from=build /out/tasks /app/tasks
COPY apps/web/ ./apps/web/

USER 10001:10001
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD ["/app/tasks", "healthcheck", "--url", "http://127.0.0.1:8787/health"]
ENTRYPOINT ["/app/tasks"]
