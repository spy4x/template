#!/bin/sh
# Writes the SPA's /config.json when the container starts, from the variables listed in the allow
# list (public-env.allow) and from nothing else. nginx's entrypoint runs it before nginx starts.
# ALLOW_FILE and OUT_FILE are overridden by the tests only.
set -eu

ALLOW_FILE="${ALLOW_FILE:-/etc/spa/public-env.allow}"
OUT_FILE="${OUT_FILE:-/tmp/config.json}"

# JSON string escaping: backslash and double quote, the only characters a value may break with
# (a newline in a value is cut to its first line by `read`).
escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

TMP="$OUT_FILE.tmp"
printf '{' > "$TMP"
SEP=''
while read -r NAME KEY; do
  case "$NAME" in '' | '#'*) continue ;; esac
  VALUE="$(printenv "$NAME" || true)"
  # An unset or empty variable is left out, so the app falls back to its default.
  [ -n "$VALUE" ] || continue
  VALUE="$(printf '%s' "$VALUE" | head -n 1)"
  printf '%s"%s":"%s"' "$SEP" "$KEY" "$(escape "$VALUE")" >> "$TMP"
  SEP=','
done < "$ALLOW_FILE"
printf '}\n' >> "$TMP"
mv "$TMP" "$OUT_FILE"
echo "spa: wrote $OUT_FILE"
