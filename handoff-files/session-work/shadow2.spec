@@@
                    // In front: the whole picture, nothing cut off.
                    let k = (ow / sw as f32).min(oh / sh as f32);
                    let (fw, fh) = (sw as f32 * k / ow, sh as f32 * k / oh);
                    let mut d = DrawU::new();
                    d.set(
                        DST,
                        [
                            (1.0 - fw) / 2.0,
                            (1.0 - fh) / 2.0,
                            (1.0 + fw) / 2.0,
                            (1.0 + fh) / 2.0,
                        ],
                    );
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*src)));
===
                    // In front: the whole picture, nothing cut off, with
                    // `VerticalFrame`'s soft shadow under it (canvas
                    // `shadowBlur` of 4 % of the width: a Gaussian of half that).
                    let k = (ow / sw as f32).min(oh / sh as f32);
                    let (fw, fh) = (sw as f32 * k / ow, sh as f32 * k / oh);
                    let pic = [
                        (1.0 - fw) / 2.0,
                        (1.0 - fh) / 2.0,
                        (1.0 + fw) / 2.0,
                        (1.0 + fh) / 2.0,
                    ];
                    let sigma = [0.02, 0.02 * ow / oh];
                    let mut shadow = DrawU::new();
                    shadow
                        .set(
                            DST,
                            [
                                pic[0] - 3.0 * sigma[0],
                                pic[1] - 3.0 * sigma[1],
                                pic[2] + 3.0 * sigma[0],
                                pic[3] + 3.0 * sigma[1],
                            ],
                        )
                        .set(CUT, pic)
                        .set(BG2, [sigma[0], sigma[1], 0.0, 0.0])
                        .set(COLOR, [0.0, 0.0, 0.0, VERTICAL_SHADOW]);
                    shadow.0[MISC * 4 + 3] = 4.0;
                    draws.push((shadow, TexKey::White));
                    let mut d = DrawU::new();
                    d.set(DST, pic);
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*src)));
@@@
/// An HDR window's encoding and SDR white (`compose.wgsl`'s `hdr`).
===
/// The vertical version's shadow under the picture (`VerticalFrame`: `rgba(0, 0, 0, 0.55)`).
const VERTICAL_SHADOW: f32 = 0.55;
/// An HDR window's encoding and SDR white (`compose.wgsl`'s `hdr`).
