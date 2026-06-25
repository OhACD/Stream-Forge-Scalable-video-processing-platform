#!/bin/sh
set -eu

base_url="${STREAM_FORGE_BASE_URL:-http://127.0.0.1:4000}"

create_response=$(curl -s -X POST "$base_url/videos" \
  -H 'content-type: application/json' \
  -H 'x-user-id: user-1' \
  -d '{"filename":"queue-smoke.mp4","contentType":"video/mp4","sizeBytes":8800,"tenantId":"tenant-a"}')

video_id=$(printf '%s' "$create_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["videoId"])')
upload_path=$(printf '%s' "$create_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["uploadPath"])')

curl -s -X POST "$base_url/internal/storage/finalize" \
  -H 'content-type: application/json' \
  -d "{\"bucket\":\"stream-forge-dev\",\"name\":\"$upload_path\"}" >/dev/null

attempt=1
while [ "$attempt" -le 30 ]; do
  details=$(curl -s -H 'x-user-id: user-1' "$base_url/videos/$video_id")
  status=$(printf '%s' "$details" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')

  if [ "$status" = "ready" ]; then
    printf '%s\n' "$details"
    exit 0
  fi

  attempt=$((attempt + 1))
done

echo "Queue-driven smoke test failed: video did not reach ready state" >&2
echo "$details" >&2
exit 1
