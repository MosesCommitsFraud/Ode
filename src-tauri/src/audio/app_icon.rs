//! Programm-Icons für die Live-Quellen: das Icon der .exe als PNG-Data-URL,
//! damit die Oberfläche es direkt in einem <img> zeigen kann.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use base64::Engine as _;
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
    DeleteObject, GetDIBits, GetObjectW, HBITMAP, HGDIOBJ,
};
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};
use windows::core::HSTRING;

/// Pfad → fertige Data-URL (oder `None`, wenn das Programm kein Icon hat).
fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Icon der Programmdatei als `data:image/png;base64,…`.
pub fn icon_data_url(exe_path: &str) -> Option<String> {
    if let Some(cached) = cache().lock().ok()?.get(exe_path) {
        return cached.clone();
    }
    let url = rgba_icon(exe_path)
        .and_then(|(w, h, rgba)| encode_png(w, h, &rgba))
        .map(|png| {
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(png)
            )
        });
    if let Ok(mut cache) = cache().lock() {
        cache.insert(exe_path.to_string(), url.clone());
    }
    url
}

/// Liest ein Bitmap als 32-Bit-BGRA, Zeilen von oben nach unten.
unsafe fn bitmap_bgra(bitmap: HBITMAP, width: i32, height: i32) -> Option<Vec<u8>> {
    unsafe {
        let dc = CreateCompatibleDC(None);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(dc);
        (lines == height).then_some(pixels)
    }
}

fn rgba_icon(exe_path: &str) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut icon = HICON::default();
        let found = ExtractIconExW(&HSTRING::from(exe_path), 0, Some(&mut icon), None, 1);
        if found == 0 || icon.is_invalid() {
            return None;
        }
        let mut info = ICONINFO::default();
        let result = (|| {
            GetIconInfo(icon, &mut info).ok()?;
            let mut bitmap = BITMAP::default();
            let size = std::mem::size_of::<BITMAP>() as i32;
            if GetObjectW(
                HGDIOBJ(info.hbmColor.0),
                size,
                Some((&mut bitmap as *mut BITMAP).cast()),
            ) == 0
            {
                return None;
            }
            let (w, h) = (bitmap.bmWidth, bitmap.bmHeight);
            let mut pixels = bitmap_bgra(info.hbmColor, w, h)?;
            // Alte Icons ohne Alphakanal: Transparenz aus der Maske nehmen.
            if pixels.chunks_exact(4).all(|p| p[3] == 0) {
                let mask = bitmap_bgra(info.hbmMask, w, h)?;
                for (p, m) in pixels.chunks_exact_mut(4).zip(mask.chunks_exact(4)) {
                    p[3] = if m[0] == 0 { 255 } else { 0 };
                }
            }
            // BGRA → RGBA
            for p in pixels.chunks_exact_mut(4) {
                p.swap(0, 2);
            }
            Some((w as u32, h as u32, pixels))
        })();
        if !info.hbmColor.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
        }
        if !info.hbmMask.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
        }
        let _ = DestroyIcon(icon);
        result
    }
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_icon_of_explorer() {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        let url = icon_data_url(&format!("{windir}\\explorer.exe")).expect("Icon");
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(url.len() > 200);
    }
}
