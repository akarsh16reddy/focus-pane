# Contributing

Thanks for helping improve Focus Pane.

## Development setup

Install the platform prerequisites listed in the [Tauri documentation](https://v2.tauri.app/start/prerequisites/), then run:

```sh
npm ci
npm run tauri dev
```

## Before opening a pull request

```sh
npm run check
npm run build
npm audit --audit-level=high
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Keep changes focused, include tests for behavior changes, and explain platform-specific limitations in the pull request.
