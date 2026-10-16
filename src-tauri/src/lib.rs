//! The StarScale Nexus desktop app: one native window showing the existing
//! web app, packed inside the program. Deliberately small; everything else
//! (sign-in, data, security rules) is unchanged from the browser version.

use tauri::Manager;

/// The only addresses the window itself may show: the app's own packed
/// pages (http://tauri.localhost on Windows) and, while developing with
/// `tauri dev`, the local Vite server. Links to anywhere else are opened in
/// the default browser by the page instead; this refuses any other attempt.
fn is_app_address(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(5180))
        }
        _ => false,
    }
}

fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_webview, url| is_app_address(url))
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: opening Nexus again brings the existing
        // window forward instead of starting a second copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Remembers the window's size and position between launches.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Opens web and email links in the default browser (see capabilities/).
        .plugin(tauri_plugin_opener::init())
        .plugin(navigation_guard())
        .run(tauri::generate_context!())
        .expect("StarScale Nexus could not start");
}
