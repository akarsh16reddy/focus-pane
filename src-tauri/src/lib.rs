use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

const DEFAULT_OPACITY: u8 = 45;
const DEFAULT_BAND_HEIGHT: u16 = 180;
const DEFAULT_BAND_POSITION: u8 = 50;

#[derive(Debug)]
struct FocusSettings {
    active: bool,
    opacity: u8,
    band_height: u16,
    band_position: u8,
    overlay_labels: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusState {
    active: bool,
    opacity: u8,
    band_height: u16,
    band_position: u8,
    monitor_count: usize,
    platform: &'static str,
    display_server: Option<String>,
}

fn clamped_opacity(value: u8) -> u8 {
    value.clamp(10, 80)
}

fn clamped_band_height(value: u16) -> u16 {
    value.clamp(80, 480)
}

fn clamped_band_position(value: u8) -> u8 {
    value.clamp(10, 90)
}

fn display_server() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_SESSION_TYPE")
            .ok()
            .map(|value| value.to_lowercase())
            .or_else(|| {
                if std::env::var_os("WAYLAND_DISPLAY").is_some() {
                    Some("wayland".into())
                } else if std::env::var_os("DISPLAY").is_some() {
                    Some("x11".into())
                } else {
                    None
                }
            })
    }

    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn snapshot(settings: &FocusSettings) -> FocusState {
    FocusState {
        active: settings.active,
        opacity: settings.opacity,
        band_height: settings.band_height,
        band_position: settings.band_position,
        monitor_count: settings.overlay_labels.len(),
        platform: std::env::consts::OS,
        display_server: display_server(),
    }
}

fn set_overlay_click_through(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::{GtkWindowExt, WidgetExt};

        let gtk_window = window.gtk_window()?;
        gtk_window.set_accept_focus(false);
        gtk_window.set_focus_on_map(false);

        // An empty input region is compositor-visible and prevents child webview
        // surfaces from intercepting input. set_pass_through is retained as a
        // compatible GTK fallback for X11 window managers.
        gtk_window.input_shape_combine_region(Some(&gtk::cairo::Region::create()));

        if let Some(gdk_window) = gtk_window.window() {
            gdk_window.set_pass_through(true);
        } else {
            gtk_window.connect_realize(|window| {
                if let Some(gdk_window) = window.window() {
                    gdk_window.set_pass_through(true);
                }
            });
        }
    }

    #[cfg(not(target_os = "linux"))]
    window.set_ignore_cursor_events(true)?;

    Ok(())
}

fn create_overlay_windows(app: &AppHandle) -> Result<Vec<String>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let mut labels = Vec::with_capacity(monitors.len());

    for (index, monitor) in monitors.into_iter().enumerate() {
        let label = format!("overlay-{index}");
        let scale = monitor.scale_factor();
        let position = monitor.position();
        let size = monitor.size();

        let window =
            WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html?overlay".into()))
                .title("Focus Pane overlay")
                .position(position.x as f64 / scale, position.y as f64 / scale)
                .inner_size(size.width as f64 / scale, size.height as f64 / scale)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .focused(false)
                .visible(false)
                .shadow(false)
                .build()
                .map_err(|error| error.to_string())?;

        window
            .set_position(PhysicalPosition::new(position.x, position.y))
            .map_err(|error| error.to_string())?;
        window
            .set_size(PhysicalSize::new(size.width, size.height))
            .map_err(|error| error.to_string())?;
        set_overlay_click_through(&window).map_err(|error| error.to_string())?;
        labels.push(label);
    }

    Ok(labels)
}

fn apply_visibility(app: &AppHandle, settings: &FocusSettings) -> Result<(), String> {
    for label in &settings.overlay_labels {
        let window = app
            .get_webview_window(label)
            .ok_or_else(|| format!("Overlay window {label} is unavailable"))?;
        if settings.active {
            window.show().map_err(|error| error.to_string())?;
        } else {
            window.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn toggle(app: &AppHandle) -> Result<FocusState, String> {
    let state = app.state::<Mutex<FocusSettings>>();
    let mut settings = state.lock().map_err(|_| "Focus state is unavailable")?;
    settings.active = !settings.active;
    apply_visibility(app, &settings)?;
    let current = snapshot(&settings);
    app.emit("focus://state", &current)
        .map_err(|error| error.to_string())?;
    Ok(current)
}

fn move_band(app: &AppHandle, amount: i8) -> Result<FocusState, String> {
    let state = app.state::<Mutex<FocusSettings>>();
    let mut settings = state.lock().map_err(|_| "Focus state is unavailable")?;
    let next_position = (settings.band_position as i16 + amount as i16).clamp(10, 90) as u8;
    settings.band_position = next_position;
    let current = snapshot(&settings);
    app.emit("focus://band", &current)
        .map_err(|error| error.to_string())?;
    Ok(current)
}

#[tauri::command]
fn toggle_focus(app: AppHandle) -> Result<FocusState, String> {
    toggle(&app)
}

#[tauri::command]
fn set_opacity(
    app: AppHandle,
    state: State<'_, Mutex<FocusSettings>>,
    opacity: u8,
) -> Result<FocusState, String> {
    let mut settings = state.lock().map_err(|_| "Focus state is unavailable")?;
    settings.opacity = clamped_opacity(opacity);
    let current = snapshot(&settings);
    app.emit("focus://opacity", settings.opacity)
        .map_err(|error| error.to_string())?;
    Ok(current)
}

#[tauri::command]
fn set_band(
    app: AppHandle,
    state: State<'_, Mutex<FocusSettings>>,
    band_height: u16,
    band_position: u8,
) -> Result<FocusState, String> {
    let mut settings = state.lock().map_err(|_| "Focus state is unavailable")?;
    settings.band_height = clamped_band_height(band_height);
    settings.band_position = clamped_band_position(band_position);
    let current = snapshot(&settings);
    app.emit("focus://band", &current)
        .map_err(|error| error.to_string())?;
    Ok(current)
}

#[tauri::command]
fn get_focus_state(state: State<'_, Mutex<FocusSettings>>) -> Result<FocusState, String> {
    let settings = state.lock().map_err(|_| "Focus state is unavailable")?;
    Ok(snapshot(&settings))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(FocusSettings {
            active: false,
            opacity: DEFAULT_OPACITY,
            band_height: DEFAULT_BAND_HEIGHT,
            band_position: DEFAULT_BAND_POSITION,
            overlay_labels: Vec::new(),
        }))
        .setup(|app| {
            let overlay_labels = create_overlay_windows(app.handle())?;
            let state = app.state::<Mutex<FocusSettings>>();
            let mut settings = state.lock().map_err(|_| "Focus state is unavailable")?;
            settings.overlay_labels = overlay_labels;
            apply_visibility(app.handle(), &settings)?;
            drop(settings);

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["Ctrl+Shift+D", "Ctrl+Shift+ArrowUp", "Ctrl+Shift+ArrowDown"])?
                    .with_handler(|app, shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
                            if shortcut.matches(modifiers, Code::KeyD) {
                                let _ = toggle(app);
                            } else if shortcut.matches(modifiers, Code::ArrowUp) {
                                let _ = move_band(app, -5);
                            } else if shortcut.matches(modifiers, Code::ArrowDown) {
                                let _ = move_band(app, 5);
                            }
                        }
                    })
                    .build(),
            )?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_focus_state,
            set_band,
            set_opacity,
            toggle_focus
        ])
        .run(tauri::generate_context!())
        .expect("error while running Focus Pane");
}

#[cfg(test)]
mod tests {
    use super::{clamped_band_height, clamped_band_position, clamped_opacity};

    #[test]
    fn opacity_is_constrained_to_a_readable_range() {
        assert_eq!(clamped_opacity(0), 10);
        assert_eq!(clamped_opacity(45), 45);
        assert_eq!(clamped_opacity(100), 80);
    }

    #[test]
    fn focus_band_height_cannot_disappear_or_cover_the_screen() {
        assert_eq!(clamped_band_height(20), 80);
        assert_eq!(clamped_band_height(180), 180);
        assert_eq!(clamped_band_height(900), 480);
    }

    #[test]
    fn focus_band_position_stays_inside_the_display() {
        assert_eq!(clamped_band_position(0), 10);
        assert_eq!(clamped_band_position(50), 50);
        assert_eq!(clamped_band_position(100), 90);
    }
}
