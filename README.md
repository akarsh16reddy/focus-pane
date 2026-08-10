# Focus Pane

Focus Pane is a small cross-platform desktop utility that dims every display while keeping the applications underneath interactive. It is intended to reduce visual distraction while reading PDFs, documentation, and long-form text.

## Current features

- One click-through overlay per connected display with a clear reading band
- Adjustable dim strength from 10% to 80%
- Adjustable reading-band height and vertical position
- `Ctrl+Shift+D` global toggle
- `Ctrl+Shift+Up/Down` global band movement
- Remembered dim strength
- Native Windows click-through
- GTK click-through for Linux X11 and Wayland sessions
- Keyboard-accessible control panel with reduced-motion support

## Development

Prerequisites are Node.js, Rust, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
npm ci
npm run tauri dev
```

Verification commands:

```sh
npm run check
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Create release installers with:

```sh
npm run tauri build
```

Generated installers belong on the GitHub Releases page rather than in the repository.

## Linux notes

Linux window stacking remains compositor-controlled. Pointer pass-through uses GTK's empty input-region and pass-through APIs, which work across GTK's X11 and Wayland backends. Some Wayland compositors may choose not to keep a regular application window above every native fullscreen surface.

Focus Pane does not capture screen contents, inspect other windows, or send telemetry.

## License

Focus Pane is available under the [MIT License](LICENSE).
