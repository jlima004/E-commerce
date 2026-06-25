#!/usr/bin/env bash
# Contract smoke for ops/nginx/medusa.conf.template
# Uses reserved .invalid hosts only — no real domains or secrets.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMPLATE="${REPO_ROOT}/ops/nginx/medusa.conf.template"
RENDERED="$(mktemp)"
TMP_DIR="$(mktemp -d)"
trap 'rm -f "${RENDERED}"; rm -rf "${TMP_DIR}"' EXIT

API_HOST="api.example.invalid"
ADMIN_HOST="admin.example.invalid"
UPSTREAM="127.0.0.1:9000"

if [[ ! -f "${TEMPLATE}" ]]; then
  echo "FAIL: missing template ${TEMPLATE}" >&2
  exit 1
fi

sed \
  -e "s/__API_HOST__/${API_HOST}/g" \
  -e "s/__ADMIN_HOST__/${ADMIN_HOST}/g" \
  -e "s/__UPSTREAM__/${UPSTREAM}/g" \
  "${TEMPLATE}" > "${RENDERED}"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"

  if ! grep -Fq "${needle}" <<< "${haystack}"; then
    echo "FAIL: ${message}" >&2
    echo "  expected to find: ${needle}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"

  if grep -Fq "${needle}" <<< "${haystack}"; then
    echo "FAIL: ${message}" >&2
    echo "  must not contain: ${needle}" >&2
    exit 1
  fi
}

CONFIG_TEXT="$(cat "${RENDERED}")"

echo "== structural contract: hosts and upstream =="
assert_contains "${CONFIG_TEXT}" "server_name ${API_HOST};" "API vhost must use __API_HOST__ placeholder"
assert_contains "${CONFIG_TEXT}" "server_name ${ADMIN_HOST};" "Admin vhost must use __ADMIN_HOST__ placeholder"
if grep -Fq "proxy_pass http://${UPSTREAM}" <<< "${CONFIG_TEXT}"; then
  echo "upstream: direct proxy_pass to ${UPSTREAM}"
elif grep -Fq "server ${UPSTREAM};" <<< "${CONFIG_TEXT}" && grep -Fq "proxy_pass http://medusa_upstream" <<< "${CONFIG_TEXT}"; then
  echo "upstream: medusa_upstream block targeting ${UPSTREAM}"
else
  echo "FAIL: upstream must target loopback/private upstream ${UPSTREAM}" >&2
  exit 1
fi
assert_not_contains "${CONFIG_TEXT}" "0.0.0.0:9000" "upstream must not expose wildcard public bind"

echo "== structural contract: /app isolation =="
assert_contains "${CONFIG_TEXT}" "/app" "Admin host must serve /app"
assert_contains "${CONFIG_TEXT}" "/health/live" "health/live must be proxied"
assert_contains "${CONFIG_TEXT}" "/health/ready" "health/ready must be proxied"

# API host must block /app; Admin must block webhook surfaces.
API_BLOCK_PATTERN='location ^~ /app'
ADMIN_HOOKS_BLOCK='location ^~ /hooks'
ADMIN_WEBHOOKS_BLOCK='location ^~ /webhooks'

if ! grep -Fq "${API_BLOCK_PATTERN}" <<< "${CONFIG_TEXT}"; then
  echo "FAIL: API host must block /app" >&2
  exit 1
fi

if ! grep -Fq 'return 404' <<< "${CONFIG_TEXT}"; then
  echo "FAIL: blocked routes must return 404" >&2
  exit 1
fi

if ! grep -Fq "${ADMIN_HOOKS_BLOCK}" <<< "${CONFIG_TEXT}"; then
  echo "FAIL: Admin host must block /hooks" >&2
  exit 1
fi

if ! grep -Fq "${ADMIN_WEBHOOKS_BLOCK}" <<< "${CONFIG_TEXT}"; then
  echo "FAIL: Admin host must block /webhooks" >&2
  exit 1
fi

echo "== structural contract: security headers and limits =="
assert_contains "${CONFIG_TEXT}" "X-Content-Type-Options" "security headers required"
assert_contains "${CONFIG_TEXT}" "Referrer-Policy" "security headers required"
assert_contains "${CONFIG_TEXT}" "X-Frame-Options" "security headers required"
assert_contains "${CONFIG_TEXT}" "Strict-Transport-Security" "HSTS required on TLS servers"
assert_contains "${CONFIG_TEXT}" "client_max_body_size 2m" "API body limit must be 2m"
assert_contains "${CONFIG_TEXT}" "client_max_body_size 10m" "Admin body limit must be 10m"
assert_contains "${CONFIG_TEXT}" "proxy_connect_timeout 5s" "connect timeout must be 5s"
assert_contains "${CONFIG_TEXT}" "proxy_read_timeout 60s" "read timeout must be 60s"
assert_contains "${CONFIG_TEXT}" "proxy_send_timeout 60s" "send timeout must be 60s"

echo "== structural contract: selective rate limit =="
assert_contains "${CONFIG_TEXT}" "limit_req" "selective rate limiting must be configured"
assert_contains "${CONFIG_TEXT}" "auth" "rate limit must target auth/login surfaces"
assert_not_contains "${CONFIG_TEXT}" "limit_req zone=global" "global rate limit is forbidden"

echo "== structural contract: raw webhook body preservation =="
assert_contains "${CONFIG_TEXT}" "proxy_pass_request_body on" "webhook locations must forward request body"
assert_contains "${CONFIG_TEXT}" "proxy_set_header Content-Length" "webhook locations must preserve Content-Length"
assert_not_contains "${CONFIG_TEXT}" "proxy_set_body" "webhook locations must not rewrite body"
assert_not_contains "${CONFIG_TEXT}" "gunzip" "webhook locations must not decompress request body"

echo "== nginx -t when available =="
if command -v nginx >/dev/null 2>&1; then
  cp "${RENDERED}" "${TMP_DIR}/medusa.conf"
  cat > "${TMP_DIR}/nginx.conf" <<EOF
events {}
http {
  include ${TMP_DIR}/medusa.conf;
}
EOF
  nginx -t -c "${TMP_DIR}/nginx.conf" -p "${TMP_DIR}"
else
  echo "SKIP: nginx binary not installed; structural assertions only"
fi

echo "PASS: nginx routing contract satisfied for ${API_HOST} and ${ADMIN_HOST}"
