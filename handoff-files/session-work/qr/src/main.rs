fn main() {
    let t = std::env::args().nth(1).unwrap();
    let c = qrcode::QrCode::new(t.as_bytes()).unwrap();
    print!("{}", c.render::<qrcode::render::svg::Color>().min_dimensions(220, 220).quiet_zone(true).build());
}
