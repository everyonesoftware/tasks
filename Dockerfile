FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN groupadd --gid 10001 daymark \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin daymark \
    && mkdir /data \
    && chown 10001:10001 /data \
    && chmod 0700 /data

COPY services/server/ ./services/server/
COPY apps/web/ ./apps/web/

USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["python", "-m", "services.server"]
