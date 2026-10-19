@@@
                PixelFormat::Nv12 => {
                    let yv = data[sy * fw + sx];
                    let c = fw * fh + (sy / 2) * fw + (sx / 2) * 2;
                    let [r, g, b] = yuv_rgb(yv, data[c], data[c + 1], hd);
                    [r, g, b, 255]
                }
===
                PixelFormat::Nv12 => {
                    let yv = data[sy * fw + sx];
                    let c = fw * fh + (sy / 2) * fw + (sx / 2) * 2;
                    let [r, g, b] = yuv_rgb(yv, data[c], data[c + 1], hd);
                    [r, g, b, 255]
                }
                // HDR: made SDR as the screens show it (`hdr.rs`).
                PixelFormat::Rgb10(t) => {
                    let i = (sy * fw + sx) * 4;
                    let word = u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
                    let [r, g, b] = crate::hdr::signal_to_sdr(crate::hdr::rgb10(word), t).map(crate::hdr::byte);
                    [r, g, b, 255]
                }
                PixelFormat::P010(t) => {
                    let w16 = |at: usize| u16::from_le_bytes([data[at], data[at + 1]]);
                    let yv = w16((sy * fw + sx) * 2);
                    let c = fw * fh * 2 + ((sy / 2) * fw + (sx / 2) * 2) * 2;
                    let rgb = crate::hdr::p010_rgb(yv, w16(c), w16(c + 2));
                    let [r, g, b] = crate::hdr::signal_to_sdr(rgb, t).map(crate::hdr::byte);
                    [r, g, b, 255]
                }
