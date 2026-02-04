#!/bin/sh
# AOP install script — download and install the AOP binary.
# Usage: curl -fsSL https://aop.com/install.sh | sh
#        curl -fsSL https://aop.com/install.sh | sh -s -- --prefix /custom/path --version 0.2.0
set -eu

RELEASES_BASE_URL="${AOP_RELEASES_URL:-https://getaop.com}"

main() {
  parse_args "$@"
  detect_platform
  resolve_version
  resolve_install_dir
  check_existing_installation
  download_binary
  verify_checksum
  install_binary
  check_prerequisites
  print_success
}

# --- Argument Parsing ---

PREFIX=""
VERSION=""

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --prefix)
        PREFIX="$2"
        shift 2
        ;;
      --version)
        VERSION="$2"
        shift 2
        ;;
      *)
        echo "Unknown argument: $1" >&2
        echo "Usage: install.sh [--prefix <dir>] [--version <version>]" >&2
        exit 1
        ;;
    esac
  done
}

# --- Platform Detection ---

OS=""
ARCH=""
BINARY_NAME=""

detect_platform() {
  local uname_os uname_arch

  uname_os="$(uname -s)"
  uname_arch="$(uname -m)"

  case "$uname_os" in
    Linux)  OS="linux" ;;
    Darwin) OS="darwin" ;;
    *)
      echo "Error: Unsupported operating system: $uname_os" >&2
      echo "Supported platforms: Linux (x64, arm64), macOS (x64, arm64)" >&2
      exit 1
      ;;
  esac

  case "$uname_arch" in
    x86_64|amd64)    ARCH="x64" ;;
    aarch64|arm64)   ARCH="arm64" ;;
    *)
      echo "Error: Unsupported architecture: $uname_arch" >&2
      echo "Supported architectures: x86_64, aarch64/arm64" >&2
      exit 1
      ;;
  esac

  BINARY_NAME="aop-${OS}-${ARCH}"
  echo "Detected platform: ${OS}-${ARCH}"
}

# --- Version Resolution ---

resolve_version() {
  if [ -n "$VERSION" ]; then
    echo "Using specified version: $VERSION"
    return
  fi

  echo "Fetching latest version..."
  VERSION="$(http_get "${RELEASES_BASE_URL}/latest/version")" || {
    echo "Error: Failed to fetch latest version from ${RELEASES_BASE_URL}/latest/version" >&2
    exit 1
  }
  VERSION="$(echo "$VERSION" | tr -d '[:space:]')"
  echo "Latest version: $VERSION"
}

# --- Install Directory ---

INSTALL_DIR=""

resolve_install_dir() {
  if [ -n "$PREFIX" ]; then
    INSTALL_DIR="${PREFIX}/bin"
  elif [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
  else
    INSTALL_DIR="${HOME}/.local/bin"
  fi

  mkdir -p "$INSTALL_DIR"
}

# --- Existing Installation Check ---

EXISTING_VERSION=""

check_existing_installation() {
  local existing_bin="${INSTALL_DIR}/aop"

  if [ -x "$existing_bin" ]; then
    EXISTING_VERSION="$("$existing_bin" --version 2>/dev/null || echo "")"
    if [ "$EXISTING_VERSION" = "$VERSION" ]; then
      echo "AOP $VERSION is already installed"
      exit 0
    fi
  fi
}

# --- HTTP Helpers ---

TMPDIR="${TMPDIR:-/tmp}"
TMP_DIR=""

http_get() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

http_download() {
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$output" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$output" "$url"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

# --- Download ---

download_binary() {
  TMP_DIR="$(mktemp -d "${TMPDIR}/aop-install.XXXXXX")"
  trap 'rm -rf "$TMP_DIR"' EXIT

  local binary_url="${RELEASES_BASE_URL}/v${VERSION}/${BINARY_NAME}"
  local checksums_url="${RELEASES_BASE_URL}/v${VERSION}/checksums.sha256"

  echo "Downloading ${BINARY_NAME} v${VERSION}..."
  http_download "$binary_url" "${TMP_DIR}/${BINARY_NAME}" || {
    echo "Error: Failed to download binary from $binary_url" >&2
    exit 1
  }

  http_download "$checksums_url" "${TMP_DIR}/checksums.sha256" || {
    echo "Error: Failed to download checksums from $checksums_url" >&2
    exit 1
  }
}

# --- Checksum Verification ---

verify_checksum() {
  local expected actual

  expected="$(grep "  ${BINARY_NAME}$" "${TMP_DIR}/checksums.sha256" | cut -d' ' -f1)"

  if [ -z "$expected" ]; then
    echo "Error: No checksum found for ${BINARY_NAME} in checksums.sha256" >&2
    rm -f "${TMP_DIR}/${BINARY_NAME}"
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${TMP_DIR}/${BINARY_NAME}" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${TMP_DIR}/${BINARY_NAME}" | cut -d' ' -f1)"
  else
    echo "Warning: sha256sum/shasum not found, skipping checksum verification" >&2
    return
  fi

  if [ "$expected" != "$actual" ]; then
    echo "Error: Checksum verification failed" >&2
    echo "  Expected: $expected" >&2
    echo "  Actual:   $actual" >&2
    rm -f "${TMP_DIR}/${BINARY_NAME}"
    exit 1
  fi

  echo "Checksum verified"
}

# --- Install ---

install_binary() {
  local target="${INSTALL_DIR}/aop"

  cp "${TMP_DIR}/${BINARY_NAME}" "$target"
  chmod +x "$target"

  if [ -n "$EXISTING_VERSION" ]; then
    echo "Upgraded AOP from $EXISTING_VERSION to $VERSION"
  else
    echo "Installed AOP $VERSION to $target"
  fi
}

# --- Prerequisite Checks ---

check_prerequisites() {
  local all_found=true

  if ! command -v git >/dev/null 2>&1; then
    echo "Warning: Git 2.40+ is required for AOP worktree management" >&2
    all_found=false
  fi

  if ! command -v claude >/dev/null 2>&1; then
    echo "Warning: Claude CLI is required for agent execution. Install from https://docs.anthropic.com/en/docs/claude-cli" >&2
    all_found=false
  fi

  # Warn if install dir is not on PATH
  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      echo "Warning: ${INSTALL_DIR} is not on your PATH. Add it with:" >&2
      echo "  export PATH=\"${INSTALL_DIR}:\$PATH\"" >&2
      all_found=false
      ;;
  esac

  if [ "$all_found" = true ]; then
    echo "All prerequisites found. Run 'aop run' to start."
  fi
}

# --- Success Message ---

print_success() {
  echo ""
  echo "AOP $VERSION installed successfully!"
  echo "Run 'aop run' to start"
}

main "$@"
