@@@
        PixelFormat::Nv12 => "nv12",
===
        PixelFormat::Nv12 => "nv12",
        // HDR cameras' and files' own pixels (an ISO file is made SDR by the encoder's format).
        PixelFormat::Rgb10(_) => "x2bgr10le",
        PixelFormat::P010(_) => "p010le",
