# Changelog

All notable changes to Focus Pane are documented here.

## [0.1.4] - 2026-08-09

### Changed

- Replace the default Tauri artwork with a Focus Pane icon set.
- Remove unused opener permissions and dependencies.
- Add cross-platform continuous integration, dependency updates, and contributor documentation.

### Security

- Limit the WebView global API surface and enforce production and development Content Security Policies.

## [0.1.3] - 2026-08-09

### Added

- Click-through dimming overlays for every detected display.
- Adjustable reading-band height, vertical position, and dim strength.
- Global shortcuts for toggling focus mode and moving the reading band.
- Windows installer and portable executable builds.

### Fixed

- Register application state before WebView startup so controller inputs work immediately.
- Start overlay reconciliation before event subscriptions to prevent stale visual settings.

### Security

- Restrict the production WebView to bundled content and Tauri IPC with a Content Security Policy.
