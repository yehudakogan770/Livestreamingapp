// ---------------------------------------------------------------------------
// Pictures served by the app: stream, web page, screen-capture and guest inputs

/// Where the app keeps the newest picture of each stream, web page,
/// screen-capture and guest input (`browser.rs`'s frame store: streams are
/// received by FFmpeg in `streams.rs`, pages and screens captured with
/// Windows Graphics Capture), JPEG or PNG.
pub trait EncodedFrames: Send + Sync {
    /// Input `id`'s first picture newer than number `after`, waiting up to
    /// `wait`: its number, its bytes and their type (`image/jpeg`, `image/png`).
    fn next(&self, id: &str, after: u64, wait: Duration) -> Option<(u64, Arc<Vec<u8>>, &'static str)>;
}

/// A JPEG or PNG as RGBA (straight alpha), from `pool`.
pub fn decode_picture(bytes: &[u8], mime: &str, pool: &FramePool, seq: u64) -> Option<VideoFrame> {
    if mime == "image/png" {
        let mut d = png::Decoder::new(std::io::Cursor::new(bytes));
        d.set_transformations(
            png::Transformations::EXPAND | png::Transformations::ALPHA | png::Transformations::STRIP_16,
        );
        let mut r = d.read_info().ok()?;
        let mut buf = vec![0; r.output_buffer_size()];
        let info = r.next_frame(&mut buf).ok()?;
        let (w, h) = (info.width, info.height);
        let px = (w as usize) * (h as usize);
        return match info.color_type {
            png::ColorType::Rgba if buf.len() >= px * 4 => Some(VideoFrame::build(pool, w, h, PixelFormat::Rgba8, seq, |out| {
                out.copy_from_slice(&buf[..px * 4]);
            })),
            png::ColorType::GrayscaleAlpha if buf.len() >= px * 2 => {
                Some(VideoFrame::build(pool, w, h, PixelFormat::Rgba8, seq, |out| {
                    for (o, g) in out.as_chunks_mut::<4>().0.iter_mut().zip(buf.as_chunks::<2>().0) {
                        *o = [g[0], g[0], g[0], g[1]];
                    }
                }))
            }
            _ => None,
        };
    }
    use zune_jpeg::zune_core::{colorspace::ColorSpace, options::DecoderOptions};
    let options = DecoderOptions::default()
        .jpeg_set_out_colorspace(ColorSpace::RGBA)
        .set_max_width(MAX_SIDE as usize)
        .set_max_height(MAX_SIDE as usize);
    let mut d = zune_jpeg::JpegDecoder::new_with_options(bytes, options);
    let rgba = d.decode().ok()?;
    let (w, h) = d.dimensions()?;
    let (w, h) = (u32::try_from(w).ok()?, u32::try_from(h).ok()?);
    if rgba.len() < (w as usize) * (h as usize) * 4 {
        return None;
    }
    Some(VideoFrame::build(pool, w, h, PixelFormat::Rgba8, seq, |out| {
        out.copy_from_slice(&rgba[..out.len()]);
    }))
}

/// The largest picture taken from the frame store (each side).
const MAX_SIDE: u32 = 4096;

/// A stream, web page, screen-capture or guest input: its pictures from the
/// app's frame store, decoded on this source's own thread as they come.
pub struct EncodedSource {
    mailbox: Arc<Mailbox>,
    id: String,
}

impl EncodedSource {
    pub fn start(id: &str, frames: Arc<dyn EncodedFrames>) -> Self {
        let mailbox = Mailbox::new();
        let mb = Arc::clone(&mailbox);
        let key = id.to_owned();
        let _ = thread::Builder::new()
            .name(format!("lumora-live-pictures-{id}"))
            .spawn(move || {
                let pool = FramePool::new(4);
                let mut after = 0u64;
                let mut seq = 0u64;
                while !mb.stopped() {
                    let Some((n, bytes, mime)) = frames.next(&key, after, Duration::from_millis(250))
                    else {
                        continue;
                    };
                    after = n;
                    if let Some(f) = decode_picture(&bytes, mime, &pool, seq) {
                        seq += 1;
                        mb.put(f);
                    }
                }
            });
        EncodedSource {
            mailbox,
            id: id.to_owned(),
        }
    }
}

impl VideoSource for EncodedSource {
    fn latest(&self) -> Option<VideoFrame> {
        self.mailbox.latest()
    }
    fn health(&self) -> SourceHealth {
        self.mailbox.health()
    }
    fn describe(&self) -> String {
        format!("Pictures from the app: {}", self.id)
    }
}

impl Drop for EncodedSource {
    fn drop(&mut self) {
        self.mailbox.stop();
    }
}

