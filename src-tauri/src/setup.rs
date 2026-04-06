use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState};

use crate::state::AppState;

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.handle().plugin(
        tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
    )?;

    // Hide from dock -- menu bar only app
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        app.set_activation_policy(ActivationPolicy::Accessory);
    }

    // Tray icon with cassette image
    let app_handle = app.handle().clone();
    let tray_icon = {
        let rgba = include_bytes!("../icons/tray-icon.rgba");
        tauri::image::Image::new_owned(rgba.to_vec(), 600, 600)
    };

    // Tray right-click menu
    let devtools_item = MenuItem::with_id(app, "devtools", "Open DevTools", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Diane", true, None::<&str>)?;
    let tray_menu = Menu::with_items(app, &[&devtools_item, &quit_item])?;

    let app_handle2 = app.handle().clone();
    TrayIconBuilder::new()
        .tooltip("Diane — Voice Recorder")
        .icon(tray_icon)
        .icon_as_template(true)
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |_app, event| {
            if event.id() == "quit" {
                app_handle2.exit(0);
            } else if event.id() == "devtools" {
                if let Some(window) = app_handle2.get_webview_window("main") {
                    window.open_devtools();
                }
            }
        })
        .on_tray_icon_event(move |_tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    // Set up window blur handler -- hide when clicking off
    if let Some(window) = app.get_webview_window("main") {
        let win = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = win.hide();
            }
        });
    }

    // Position window at right edge of screen
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let screen = monitor.size();
            let scale = monitor.scale_factor();
            let win_w = 344.0; // sidebar + margins
            let screen_h = screen.height as f64 / scale;
            let screen_w = screen.width as f64 / scale;
            let menu_bar_h = 25.0;
            let win_h = screen_h - menu_bar_h;
            let x = screen_w - win_w;
            let y = menu_bar_h;
            let _ = window.set_size(tauri::Size::Logical(
                tauri::LogicalSize::new(win_w, win_h),
            ));
            let _ = window.set_position(tauri::Position::Logical(
                tauri::LogicalPosition::new(x, y),
            ));
        }
    }

    // Start meeting detector
    {
        let app_handle = app.handle().clone();
        let state: tauri::State<AppState> = app.state();
        let mut detector = state.meeting_detector.lock().unwrap();
        detector.start(app_handle);
    }

    Ok(())
}
