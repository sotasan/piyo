#[cfg(target_os = "macos")]
mod platform {
    use cached::SizedCache;
    use cached::proc_macro::cached;
    use objc2::AnyThread;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSSize, NSString};

    pub const DEFAULT_SIZE: u32 = 32;
    const MIN_SIZE: u32 = 8;
    const MAX_SIZE: u32 = 512;
    const CACHE_CAPACITY: usize = 512;

    fn clamp_size(size: u32) -> u32 {
        size.clamp(MIN_SIZE, MAX_SIZE)
    }

    #[cached(
        ty = "SizedCache<(String, u32), Vec<u8>>",
        create = "{ SizedCache::with_size(CACHE_CAPACITY) }",
        convert = r#"{ (path.to_string(), clamp_size(size)) }"#,
        option = true
    )]
    pub fn icon_png(path: &str, size: u32) -> Option<Vec<u8>> {
        render_png(path, clamp_size(size))
    }

    fn render_png(path: &str, size: u32) -> Option<Vec<u8>> {
        let workspace = NSWorkspace::sharedWorkspace();
        let ns_path = NSString::from_str(path);
        let image: Retained<NSImage> = workspace.iconForFile(&ns_path);
        image.setSize(NSSize {
            width: size as f64,
            height: size as f64,
        });

        let tiff = image.TIFFRepresentation()?;
        let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let empty: Retained<NSDictionary<NSString>> = NSDictionary::new();
        let png = unsafe {
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &empty)
        }?;
        Some(png.to_vec())
    }
}

#[cfg(target_os = "macos")]
pub use platform::{DEFAULT_SIZE, icon_png};

#[cfg(not(target_os = "macos"))]
pub const DEFAULT_SIZE: u32 = 32;

#[cfg(not(target_os = "macos"))]
pub fn icon_png(_path: &str, _size: u32) -> Option<Vec<u8>> {
    None
}

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let path_raw = request.uri().path().to_string();
    let query = request.uri().query().unwrap_or("").to_string();

    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(build_response(&path_raw, &query));
    });
}

fn build_response(path_raw: &str, query: &str) -> Response<Vec<u8>> {
    if path_raw.is_empty() || path_raw == "/" {
        return error(StatusCode::BAD_REQUEST, "missing path");
    }
    let Some(decoded) = percent_decode(path_raw) else {
        return error(StatusCode::BAD_REQUEST, "invalid utf-8");
    };
    let size = parse_size(query).unwrap_or(DEFAULT_SIZE);

    match icon_png(&decoded, size) {
        Some(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CACHE_CONTROL, "public, max-age=86400, immutable")
            .body(bytes)
            .unwrap(),
        None => error(StatusCode::INTERNAL_SERVER_ERROR, "icon failed"),
    }
}

fn error(status: StatusCode, msg: &'static str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn parse_size(query: &str) -> Option<u32> {
    query
        .split('&')
        .filter_map(|p| p.split_once('='))
        .find(|(k, _)| *k == "size")
        .and_then(|(_, v)| v.parse().ok())
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16)?;
            let lo = (bytes[i + 2] as char).to_digit(16)?;
            out.push(((hi << 4) | lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}
