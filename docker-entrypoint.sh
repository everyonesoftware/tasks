#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
    set -- serve --host 0.0.0.0 --port 8787 --db /data/daymark.sqlite3 \
        --public-origin "https://${DAYMARK_HOST:?Set DAYMARK_HOST to your Tailscale HTTPS hostname}" \
        --allow-insecure-http
fi

exec tasks "$@"
