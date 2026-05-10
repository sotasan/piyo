use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response, StatusCode, header};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};
use url::Url;

pub const DEFAULT_SIZE: u32 = 32;

#[cfg(target_os = "macos")]
mod platform {
    use cached::SizedCache;
    use cached::proc_macro::cached;
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSSize, NSString};

    const MIN_SIZE: u32 = 8;
    const MAX_SIZE: u32 = 512;
    const CACHE_CAPACITY: usize = 512;

    fn clamp_size(size: u32) -> u32 {
        size.clamp(MIN_SIZE, MAX_SIZE)
    }

    #[cached(
        ty = "SizedCache<(String, u32, String), Vec<u8>>",
        create = "{ SizedCache::with_size(CACHE_CAPACITY) }",
        convert = r#"{ (path.to_string(), clamp_size(size), revision.to_string()) }"#,
        option = true
    )]
    pub fn icon_png(path: &str, size: u32, revision: &str) -> Option<Vec<u8>> {
        let _ = revision;
        render_png(path, clamp_size(size))
    }

    fn render_png(path: &str, size: u32) -> Option<Vec<u8>> {
        let workspace = NSWorkspace::sharedWorkspace();
        let image: objc2::rc::Retained<NSImage> = workspace.iconForFile(&NSString::from_str(path));
        image.setSize(NSSize {
            width: size as f64,
            height: size as f64,
        });

        let tiff = image.TIFFRepresentation()?;
        let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let empty = NSDictionary::<NSString>::new();
        let png = unsafe {
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &empty)
        }?;
        Some(png.to_vec())
    }
}

#[cfg(target_os = "macos")]
pub use platform::icon_png;

#[cfg(not(target_os = "macos"))]
pub fn icon_png(_path: &str, _size: u32, _revision: &str) -> Option<Vec<u8>> {
    None
}

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let uri = request.uri().to_string();

    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(build_response(&uri));
    });
}

fn build_response(uri: &str) -> Response<Vec<u8>> {
    let Ok(url) = Url::parse(uri) else {
        return error(StatusCode::BAD_REQUEST, "bad url");
    };
    let Ok(path) = percent_decode_str(url.path()).decode_utf8() else {
        return error(StatusCode::BAD_REQUEST, "invalid utf-8");
    };
    if path.is_empty() || path == "/" {
        return error(StatusCode::BAD_REQUEST, "missing path");
    }

    let mut size = DEFAULT_SIZE;
    let mut revision = String::new();
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "size" => {
                if let Ok(parsed) = value.parse() {
                    size = parsed;
                }
            }
            "v" => revision = value.into_owned(),
            _ => {}
        }
    }

    match icon_png(&path, size, &revision) {
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
