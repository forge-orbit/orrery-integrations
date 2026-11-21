#!/usr/bin/env bash
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
mode="${1:-}"

down() {
  local upstream status=0
  if [[ -f "$state/upstream" ]]; then
    upstream="$(cat "$state/upstream")"
    "$launcher" down "$upstream" || status=$?
  fi
  rm -f -- "$state/agent.key" "$state/human.json"
  return "$status"
}

case "$mode" in
  run)
    verify="$here/verify.sh"
    if output="$("$verify" up "${2:-$root/../orrery}")"; then
      printf '%s\n' "$output"
    else
      printf '%s\n' "$output" >&2
      exit 1
    fi
    state="$(sed -n 's/^RUN_DIR=//p' <<< "$output")"
    trap '"$verify" down "$state"' EXIT
    "$verify" doctor "$state"
    "$verify" drive "$state"
    ;;
  up)
    orrery="$(cd "${2:-$root/../orrery}" && pwd)"
    launcher="$orrery/.agents/skills/verify-orrery/scripts/orrery-verify.sh"
    [[ -x "$launcher" ]] || { echo "Orrery verification launcher missing at $launcher" >&2; exit 1; }
    state="$(mktemp -d "${TMPDIR:-/tmp}/orrery-integrations-verify.XXXXXX")"
    mkdir "$state/evidence"
    printf '%s\n' "$orrery" > "$state/orrery-checkout"
    printf 'RUN_DIR=%s\n' "$state"
    on_up_failure() {
      local status=$?
      if [[ "$status" != 0 ]]; then
        for run_env in "$state"/orrery/*/env; do
          [[ -f "$run_env" ]] || continue
          printf '%s\n' "${run_env%/env}" > "$state/upstream"
          down || true
        done
      fi
    }
    trap on_up_failure EXIT

    bootstrap="$(openssl rand -hex 24)"
    ORRERY_VERIFY_BASE="$state/orrery" BOOTSTRAP_SECRET="$bootstrap" setsid --wait "$launcher" up \
      > "$state/evidence/orrery-up.log" 2>&1
    upstream="$(sed -n 's/^RUN_DIR=//p' "$state/evidence/orrery-up.log")"
    printf '%s\n' "$upstream" > "$state/upstream"
    if ! "$orrery/.agents/skills/verify-orrery/scripts/mailpit.sh" up "$upstream" \
      > "$state/evidence/mailpit-up.log" 2>&1; then
      docker rm -f "orrery-verify-mailpit-${upstream##*/}" >/dev/null 2>&1 || true
      exit 1
    fi
    BOOTSTRAP_SECRET="$bootstrap" node "$here/fixture.mjs" seed "$state" "$upstream"
    {
      printf 'integrations %s\n' "$(git -C "$root" rev-parse HEAD)"
      printf 'orrery %s\n' "$(git -C "$orrery" rev-parse HEAD)"
      if [[ -n "$(git -C "$root" status --porcelain)" ]]; then printf 'integrations tree dirty\n'; fi
      if [[ -n "$(git -C "$orrery" status --porcelain)" ]]; then printf 'orrery tree dirty\n'; fi
      node --version
      codex --version
      claude --version
    } > "$state/evidence/versions.txt"
    printf 'Seeded Orrery and Mailpit.\n'
    ;;
  doctor|drive|down)
    state="${2:?Pass the RUN_DIR from up.}"
    [[ -f "$state/orrery-checkout" ]] || { echo "Unknown integrations verification run at $state" >&2; exit 1; }
    orrery="$(cat "$state/orrery-checkout")"
    launcher="$orrery/.agents/skills/verify-orrery/scripts/orrery-verify.sh"
    if [[ "$mode" == down ]]; then
      down
      printf 'Evidence kept in %s/evidence\n' "$state"
      exit
    fi
    upstream="$(cat "$state/upstream")"
    if [[ "$mode" == doctor ]]; then
      {
        "$launcher" doctor "$upstream"
        node "$here/fixture.mjs" doctor "$state" "$upstream"
        codex login status >/dev/null 2>&1
        claude auth status >/dev/null 2>&1
        printf 'ok    both CLI logins\n'
      } | tee "$state/evidence/doctor.log"
    else
      mapfile -t fixture < "$state/fixture"
      date -u +'%FT%T.%3NZ' > "$state/drive-started"
      (
        cd "$root"
        unset ORRERY_API_KEY ORRERY_AGENT_KEY ORRERY_AGENT_KEY_FILE
        export ORRERY_URL="${fixture[0]}" ORRERY_API_KEY_FILE="$state/agent.key"
        export ORRERY_SMOKE_HUMAN_FILE="$state/human.json"
        pnpm run smoke:installed "${fixture[1]}" "${fixture[2]}"
      ) 2>&1 | tee "$state/evidence/installed.log"
      node "$here/fixture.mjs" mail "$state" "$upstream" | tee "$state/evidence/notification.json"
    fi
    ;;
  *)
    echo "Usage: $0 run|up [ORRERY_CHECKOUT] | doctor RUN_DIR | drive RUN_DIR | down RUN_DIR" >&2
    exit 2
    ;;
esac
