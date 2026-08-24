#!/usr/bin/env bash
# shellcheck shell=bash

SUTURA_MAINTENANCE_LEASE_FILE=""
SUTURA_MAINTENANCE_LEASE_NEXT_FILE=""
SUTURA_MAINTENANCE_LEASE_LABEL=""
SUTURA_MAINTENANCE_LEASE_TTL_SECONDS=""
SUTURA_MAINTENANCE_RENEW_PID=""
SUTURA_MAINTENANCE_RENEW_START=""
SUTURA_MAINTENANCE_MAIN_PID=""
SUTURA_MAINTENANCE_MAIN_START=""

_sutura_maintenance_process_start() {
  local pid="$1"
  local stat_line suffix
  local -a fields

  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/stat" ]] || return 1
  IFS= read -r stat_line < "/proc/$pid/stat" || return 1
  suffix="${stat_line##*) }"
  read -r -a fields <<< "$suffix"
  [[ "${#fields[@]}" -ge 20 ]] || return 1
  printf '%s\n' "${fields[19]}"
}

_sutura_maintenance_refresh() {
  local now_epoch expires_epoch

  [[ -n "$SUTURA_MAINTENANCE_LEASE_FILE" ]] || return 1
  now_epoch="$(date +%s)" || return 1
  [[ "$now_epoch" =~ ^[0-9]+$ ]] || return 1
  expires_epoch="$((now_epoch + SUTURA_MAINTENANCE_LEASE_TTL_SECONDS))"

  if ! (
    umask 077
    printf '%s %s\n' "$expires_epoch" "$SUTURA_MAINTENANCE_LEASE_LABEL" \
      > "$SUTURA_MAINTENANCE_LEASE_NEXT_FILE"
  ); then
    rm -f -- "$SUTURA_MAINTENANCE_LEASE_NEXT_FILE"
    return 1
  fi
  chmod 600 -- "$SUTURA_MAINTENANCE_LEASE_NEXT_FILE" || {
    rm -f -- "$SUTURA_MAINTENANCE_LEASE_NEXT_FILE"
    return 1
  }
  mv -f -- "$SUTURA_MAINTENANCE_LEASE_NEXT_FILE" "$SUTURA_MAINTENANCE_LEASE_FILE"
}

sutura_maintenance_lease_release() {
  local renew_start=""

  if [[ -n "$SUTURA_MAINTENANCE_RENEW_PID" ]]; then
    renew_start="$(_sutura_maintenance_process_start "$SUTURA_MAINTENANCE_RENEW_PID" 2>/dev/null || true)"
    if [[ -n "$renew_start" && "$renew_start" == "$SUTURA_MAINTENANCE_RENEW_START" ]]; then
      kill -TERM "$SUTURA_MAINTENANCE_RENEW_PID" 2>/dev/null || true
    fi
    wait "$SUTURA_MAINTENANCE_RENEW_PID" 2>/dev/null || true
  fi

  if [[ -n "$SUTURA_MAINTENANCE_LEASE_NEXT_FILE" ]]; then
    rm -f -- "$SUTURA_MAINTENANCE_LEASE_NEXT_FILE"
  fi
  if [[ -n "$SUTURA_MAINTENANCE_LEASE_FILE" ]]; then
    rm -f -- "$SUTURA_MAINTENANCE_LEASE_FILE"
  fi

  SUTURA_MAINTENANCE_LEASE_FILE=""
  SUTURA_MAINTENANCE_LEASE_NEXT_FILE=""
  SUTURA_MAINTENANCE_LEASE_LABEL=""
  SUTURA_MAINTENANCE_LEASE_TTL_SECONDS=""
  SUTURA_MAINTENANCE_RENEW_PID=""
  SUTURA_MAINTENANCE_RENEW_START=""
  SUTURA_MAINTENANCE_MAIN_PID=""
  SUTURA_MAINTENANCE_MAIN_START=""
  return 0
}

sutura_maintenance_lease_acquire() {
  local lease_id="${1:-}"
  local label="${2:-}"
  local lease_dir="${SUTURA_KEEP_AWAKE_DIR:-/home/trescejas/.sutura-keep-awake}"
  local ttl_seconds="${SUTURA_KEEP_AWAKE_TTL_SECONDS:-300}"
  local refresh_seconds="${SUTURA_KEEP_AWAKE_REFRESH_SECONDS:-60}"
  local max_ttl_seconds="${SUTURA_KEEP_AWAKE_MAX_TTL_SECONDS:-900}"
  local current_start

  if [[ -n "$SUTURA_MAINTENANCE_LEASE_FILE" ]]; then
    echo "Ya hay un lease de mantenimiento activo en este proceso" >&2
    return 1
  fi
  if [[ ! "$lease_id" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]]; then
    echo "Identificador de lease no válido: $lease_id" >&2
    return 2
  fi
  if [[ -z "$label" || "${#label}" -gt 160 || "$label" == *$'\n'* || "$label" == *$'\r'* ]]; then
    echo "La etiqueta del lease no es válida" >&2
    return 2
  fi
  if [[ ! "$ttl_seconds" =~ ^[0-9]+$ || ! "$refresh_seconds" =~ ^[0-9]+$ || ! "$max_ttl_seconds" =~ ^[0-9]+$ ]]; then
    echo "TTL, intervalo de renovación y TTL máximo deben ser enteros positivos" >&2
    return 2
  fi
  if (( refresh_seconds < 1 || ttl_seconds < refresh_seconds * 3 || ttl_seconds > max_ttl_seconds )); then
    echo "El TTL debe ser al menos tres veces el intervalo y no superar el TTL máximo" >&2
    return 2
  fi
  if [[ "$lease_dir" != /* || "$lease_dir" == "/" || -L "$lease_dir" ]]; then
    echo "Directorio de leases no válido: $lease_dir" >&2
    return 2
  fi

  mkdir -p -- "$lease_dir" || return 1
  if [[ ! -d "$lease_dir" || -L "$lease_dir" ]]; then
    echo "No es un directorio de leases seguro: $lease_dir" >&2
    return 1
  fi
  chmod 700 -- "$lease_dir" || return 1

  SUTURA_MAINTENANCE_LEASE_FILE="$(
    umask 077
    mktemp -- "$lease_dir/${lease_id}.XXXXXXXX.lease"
  )" || return 1
  chmod 600 -- "$SUTURA_MAINTENANCE_LEASE_FILE" || {
    rm -f -- "$SUTURA_MAINTENANCE_LEASE_FILE"
    SUTURA_MAINTENANCE_LEASE_FILE=""
    return 1
  }
  SUTURA_MAINTENANCE_LEASE_NEXT_FILE="${SUTURA_MAINTENANCE_LEASE_FILE}.next"
  SUTURA_MAINTENANCE_LEASE_LABEL="$label"
  SUTURA_MAINTENANCE_LEASE_TTL_SECONDS="$ttl_seconds"
  SUTURA_MAINTENANCE_MAIN_PID="${BASHPID:-$$}"
  SUTURA_MAINTENANCE_MAIN_START="$(_sutura_maintenance_process_start "$SUTURA_MAINTENANCE_MAIN_PID" || true)"

  if [[ -z "$SUTURA_MAINTENANCE_MAIN_START" ]] || ! _sutura_maintenance_refresh; then
    sutura_maintenance_lease_release
    echo "No se pudo adquirir el lease de mantenimiento" >&2
    return 1
  fi

  (
    trap 'exit 0' HUP INT TERM
    trap - EXIT
    while true; do
      sleep "$refresh_seconds"
      current_start="$(_sutura_maintenance_process_start "$SUTURA_MAINTENANCE_MAIN_PID" 2>/dev/null || true)"
      if [[ -z "$current_start" || "$current_start" != "$SUTURA_MAINTENANCE_MAIN_START" ]]; then
        exit 0
      fi
      if ! _sutura_maintenance_refresh; then
        echo "No se pudo renovar el lease de mantenimiento; se aborta el despliegue" >&2
        current_start="$(_sutura_maintenance_process_start "$SUTURA_MAINTENANCE_MAIN_PID" 2>/dev/null || true)"
        if [[ "$current_start" == "$SUTURA_MAINTENANCE_MAIN_START" ]]; then
          kill -TERM "$SUTURA_MAINTENANCE_MAIN_PID" 2>/dev/null || true
        fi
        exit 1
      fi
    done
  ) &
  SUTURA_MAINTENANCE_RENEW_PID="$!"
  SUTURA_MAINTENANCE_RENEW_START="$(_sutura_maintenance_process_start "$SUTURA_MAINTENANCE_RENEW_PID" || true)"
  if [[ -z "$SUTURA_MAINTENANCE_RENEW_START" ]]; then
    sutura_maintenance_lease_release
    echo "No se pudo iniciar la renovación del lease" >&2
    return 1
  fi
}

sutura_maintenance_leases_check() {
  local lease_dir="${SUTURA_KEEP_AWAKE_DIR:-/home/trescejas/.sutura-keep-awake}"
  local max_ttl_seconds="${SUTURA_KEEP_AWAKE_MAX_TTL_SECONDS:-900}"
  local now_epoch size content expires_text label expires_epoch
  local had_error=0
  local -a lease_files active_labels

  if [[ ! "$max_ttl_seconds" =~ ^[0-9]+$ ]] || (( max_ttl_seconds < 1 )); then
    echo "error: SUTURA_KEEP_AWAKE_MAX_TTL_SECONDS no es válido" >&2
    return 2
  fi
  if [[ "$lease_dir" != /* || "$lease_dir" == "/" || -L "$lease_dir" ]]; then
    echo "error: directorio de leases no válido: $lease_dir" >&2
    return 2
  fi
  if [[ ! -e "$lease_dir" ]]; then
    echo "none: no hay leases de despliegue SCRIB"
    return 1
  fi
  if [[ ! -d "$lease_dir" || ! -r "$lease_dir" || ! -x "$lease_dir" ]]; then
    echo "error: no se puede inspeccionar el directorio de leases" >&2
    return 2
  fi

  now_epoch="$(date +%s)" || {
    echo "error: no se pudo consultar la hora" >&2
    return 2
  }
  [[ "$now_epoch" =~ ^[0-9]+$ ]] || {
    echo "error: la hora actual no es válida" >&2
    return 2
  }

  shopt -s nullglob
  lease_files=("$lease_dir"/scrib-*.lease)
  shopt -u nullglob
  if (( ${#lease_files[@]} > 256 )); then
    echo "error: hay demasiados leases de despliegue" >&2
    return 2
  fi

  for lease_file in "${lease_files[@]}"; do
    if [[ -L "$lease_file" || ! -f "$lease_file" ]]; then
      echo "error: lease no regular: ${lease_file##*/}" >&2
      had_error=1
      continue
    fi
    size="$(stat -c '%s' -- "$lease_file" 2>/dev/null || true)"
    if [[ ! "$size" =~ ^[0-9]+$ ]] || (( size < 3 || size > 1024 )); then
      echo "error: tamaño de lease no válido: ${lease_file##*/}" >&2
      had_error=1
      continue
    fi
    content="$(<"$lease_file")" || {
      echo "error: no se pudo leer el lease: ${lease_file##*/}" >&2
      had_error=1
      continue
    }
    if [[ "$content" == *$'\n'* || "$content" == *$'\r'* ]]; then
      echo "error: lease multilínea: ${lease_file##*/}" >&2
      had_error=1
      continue
    fi
    expires_text="${content%%[[:space:]]*}"
    label="${content#"$expires_text"}"
    label="${label#${label%%[![:space:]]*}}"
    if [[ ! "$expires_text" =~ ^[0-9]{1,12}$ || -z "$label" || "${#label}" -gt 160 ]]; then
      echo "error: contenido de lease no válido: ${lease_file##*/}" >&2
      had_error=1
      continue
    fi
    expires_epoch="$((10#$expires_text))"
    if (( expires_epoch > now_epoch + max_ttl_seconds )); then
      echo "error: vencimiento de lease fuera de rango: ${lease_file##*/}" >&2
      had_error=1
      continue
    fi
    if (( expires_epoch > now_epoch )); then
      active_labels+=("$label hasta $expires_epoch")
    fi
  done

  if (( had_error != 0 )); then
    return 2
  fi
  if (( ${#active_labels[@]} > 0 )); then
    printf 'active: %s\n' "$(IFS=' | '; echo "${active_labels[*]}")"
    return 0
  fi
  echo "none: no hay leases de despliegue SCRIB"
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    check)
      if (( $# != 1 )); then
        echo "uso: $0 check" >&2
        exit 64
      fi
      sutura_maintenance_leases_check
      exit "$?"
      ;;
    *)
      echo "uso: $0 check" >&2
      exit 64
      ;;
  esac
fi
