## ADDED Requirements

### Requirement: One-line installation
The system SHALL be installable via a single curl command.

#### Scenario: Default installation
- **WHEN** user runs `curl -fsSL https://aop.com/install.sh | bash`
- **THEN** system downloads the correct binary for the user's OS and architecture
- **AND** places it in a directory on the user's PATH
- **AND** prints a success message with the installed version

#### Scenario: Installation with custom directory
- **WHEN** user runs `curl -fsSL https://aop.com/install.sh | bash -s -- --prefix /custom/path`
- **THEN** system installs the binary to `/custom/path/bin/aop`

### Requirement: Platform detection
The system SHALL detect the user's operating system and CPU architecture automatically.

#### Scenario: Detect Linux x64
- **WHEN** install script runs on Linux with x86_64 CPU
- **THEN** system downloads `aop-linux-x64`

#### Scenario: Detect Linux ARM64
- **WHEN** install script runs on Linux with aarch64/arm64 CPU
- **THEN** system downloads `aop-linux-arm64`

#### Scenario: Detect macOS x64
- **WHEN** install script runs on macOS with x86_64 CPU
- **THEN** system downloads `aop-darwin-x64`

#### Scenario: Detect macOS ARM64 (Apple Silicon)
- **WHEN** install script runs on macOS with arm64 CPU
- **THEN** system downloads `aop-darwin-arm64`

#### Scenario: Unsupported platform
- **WHEN** install script runs on an unsupported OS (e.g., Windows, FreeBSD)
- **THEN** system prints an error with supported platforms and exits with code 1

### Requirement: Integrity verification
The system SHALL verify the downloaded binary's integrity before installing.

#### Scenario: Checksum verification passes
- **WHEN** install script downloads the binary and checksums file
- **THEN** system verifies the binary's SHA-256 hash matches the expected value
- **AND** proceeds with installation

#### Scenario: Checksum verification fails
- **WHEN** the downloaded binary's hash does not match
- **THEN** system prints an error about integrity verification failure
- **AND** removes the downloaded file
- **AND** exits with code 1

### Requirement: Installation directory selection
The system SHALL install to a sensible default location with fallback options.

#### Scenario: Install to /usr/local/bin when writable
- **WHEN** user has write access to `/usr/local/bin`
- **THEN** system installs to `/usr/local/bin/aop`

#### Scenario: Fall back to ~/.local/bin
- **WHEN** user does not have write access to `/usr/local/bin`
- **THEN** system installs to `~/.local/bin/aop`
- **AND** warns if `~/.local/bin` is not on PATH

#### Scenario: Create directory if missing
- **WHEN** the target install directory does not exist
- **THEN** system creates it with `mkdir -p`

### Requirement: Prerequisite checking
The system SHALL check for required external tools after installation.

#### Scenario: Git check
- **WHEN** installation completes
- **THEN** system checks for `git` in PATH
- **AND** if missing, prints a warning: "Git 2.40+ is required for AOP worktree management"

#### Scenario: Claude CLI check
- **WHEN** installation completes
- **THEN** system checks for `claude` in PATH
- **AND** if missing, prints a warning: "Claude CLI is required for agent execution. Install from https://docs.anthropic.com/en/docs/claude-cli"

#### Scenario: All prerequisites present
- **WHEN** installation completes and git and claude are both found
- **THEN** system prints "All prerequisites found. Run 'aop run' to start."

### Requirement: Idempotent installation
The system SHALL handle repeated installations gracefully.

#### Scenario: Upgrade existing installation
- **WHEN** install script runs and an `aop` binary already exists in the target directory
- **THEN** system replaces it with the new version
- **AND** prints "Upgraded AOP from <old-version> to <new-version>"

#### Scenario: Same version reinstall
- **WHEN** install script runs and the installed version matches the latest
- **THEN** system prints "AOP <version> is already installed" and exits with code 0

### Requirement: Minimal dependencies
The install script SHALL only require tools commonly available on Unix systems.

#### Scenario: Required tools
- **WHEN** install script runs
- **THEN** system uses only `curl` (or `wget` as fallback), `uname`, `sha256sum` (or `shasum`), and standard POSIX utilities
- **AND** does not require Python, Node.js, Bun, or other runtimes
