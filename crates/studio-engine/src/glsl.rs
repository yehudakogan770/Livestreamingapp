//! The editor's WebGL 2 programs (GLSL ES 3.00), made into Vulkan-style GLSL
//! 4.50 that naga translates for every native GPU API.
//!
//! The changes are mechanical, so the native picture runs the very same math:
//! - loose `uniform float uX;` values go into one uniform block (std140),
//! - each `sampler2D`/`sampler3D` becomes a texture plus one shared sampler,
//! - inputs and outputs get explicit locations,
//! - the vertex stage turns Y over, so every texture is laid out in memory
//!   exactly as WebGL lays it out (row 0 at the bottom of the picture).

use std::collections::HashMap;
use std::fmt::Write as _;

/// The shared filtering sampler (linear, clamped at the edges, like WebGL's textures).
pub const SAMPLER_BINDING: u32 = 1;
/// The uniform block, when a program has loose uniforms.
pub const UNIFORM_BINDING: u32 = 0;
/// Textures follow, in the order the program declares them.
pub const FIRST_TEXTURE_BINDING: u32 = 2;

const SAMPLER_NAME: &str = "lumora_smp";
const BLOCK_NAME: &str = "LumoraUniforms";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TexDim {
    D2,
    D3,
}

/// A loose uniform's type (how many numbers it takes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UniformType {
    Float,
    Int,
    Vec2,
    Vec3,
    Vec4,
    Mat3,
}

impl UniformType {
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "float" => Self::Float,
            "int" => Self::Int,
            "vec2" => Self::Vec2,
            "vec3" => Self::Vec3,
            "vec4" => Self::Vec4,
            "mat3" => Self::Mat3,
            _ => return None,
        })
    }
    /// How many numbers a program is given for it.
    pub fn components(self) -> usize {
        match self {
            Self::Float | Self::Int => 1,
            Self::Vec2 => 2,
            Self::Vec3 => 3,
            Self::Vec4 => 4,
            Self::Mat3 => 9,
        }
    }
    /// std140: (alignment, size) in bytes.
    pub fn std140(self) -> (usize, usize) {
        match self {
            Self::Float | Self::Int => (4, 4),
            Self::Vec2 => (8, 8),
            Self::Vec3 => (16, 12),
            Self::Vec4 => (16, 16),
            Self::Mat3 => (16, 48),
        }
    }
    fn glsl(self) -> &'static str {
        match self {
            Self::Float => "float",
            Self::Int => "int",
            Self::Vec2 => "vec2",
            Self::Vec3 => "vec3",
            Self::Vec4 => "vec4",
            Self::Mat3 => "mat3",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UniformField {
    pub name: String,
    pub ty: UniformType,
    pub offset: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextureSlot {
    pub name: String,
    pub dim: TexDim,
    pub binding: u32,
}

/// Where a program's inputs go.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Layout {
    pub uniforms: Vec<UniformField>,
    /// The uniform block's size (a multiple of 16; 0 when there is none).
    pub block_size: usize,
    pub textures: Vec<TextureSlot>,
}

impl Layout {
    pub fn field(&self, name: &str) -> Option<&UniformField> {
        self.uniforms.iter().find(|u| u.name == name)
    }
    pub fn texture(&self, name: &str) -> Option<&TextureSlot> {
        self.textures.iter().find(|t| t.name == name)
    }

    /// Write one value (as the program's numbers) into a uniform block.
    /// Unknown names are ignored, as WebGL ignores uniforms a program doesn't use.
    pub fn put(&self, block: &mut [u8], name: &str, values: &[f32]) {
        let Some(f) = self.field(name) else { return };
        let write = |block: &mut [u8], at: usize, bytes: [u8; 4]| {
            if let Some(dst) = block.get_mut(at..at + 4) {
                dst.copy_from_slice(&bytes);
            }
        };
        match f.ty {
            UniformType::Int => {
                let v = values.first().copied().unwrap_or(0.0).round() as i32;
                write(block, f.offset, v.to_le_bytes());
            }
            UniformType::Mat3 => {
                // Column-major, each column padded to 16 bytes.
                for (i, v) in values.iter().take(9).enumerate() {
                    write(
                        block,
                        f.offset + (i / 3) * 16 + (i % 3) * 4,
                        v.to_le_bytes(),
                    );
                }
            }
            ty => {
                for (i, v) in values.iter().take(ty.components()).enumerate() {
                    write(block, f.offset + i * 4, v.to_le_bytes());
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Vertex,
    Fragment,
}

/// A program made ready for naga: both stages' sources and the shared layout.
#[derive(Debug, Clone)]
pub struct Converted {
    pub vertex: String,
    pub fragment: String,
    pub layout: Layout,
}

#[derive(Debug, Clone, PartialEq)]
enum Tok<'a> {
    Ident(&'a str),
    Other(&'a str),
}

/// Split source into identifiers and everything else (comments and spaces kept as they are).
fn tokens(src: &str) -> Vec<Tok<'_>> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_alphabetic() || c == b'_' {
            let s = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
            out.push(Tok::Ident(&src[s..i]));
        } else if c.is_ascii_digit() {
            // Numbers (with their suffixes and exponents) are never names.
            let s = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'.' || b[i] == b'_') {
                i += 1;
            }
            out.push(Tok::Other(&src[s..i]));
        } else if c == b'/' && b.get(i + 1) == Some(&b'/') {
            let s = i;
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            out.push(Tok::Other(&src[s..i]));
        } else if c == b'/' && b.get(i + 1) == Some(&b'*') {
            let s = i;
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(b.len());
            out.push(Tok::Other(&src[s..i]));
        } else {
            // One character at a time (UTF-8 safe).
            let len = src[i..].chars().next().map_or(1, char::len_utf8);
            out.push(Tok::Other(&src[i..i + len]));
            i += len;
        }
    }
    out
}

fn is_space(t: &Tok<'_>) -> bool {
    matches!(t, Tok::Other(s) if s.trim().is_empty() || s.starts_with("//") || s.starts_with("/*"))
}

/// Next meaningful token at or after `i`.
fn next_sig(toks: &[Tok<'_>], mut i: usize) -> Option<usize> {
    while i < toks.len() {
        if !is_space(&toks[i]) {
            return Some(i);
        }
        i += 1;
    }
    None
}

const TEXTURE_FUNCS: [&str; 5] = [
    "texture",
    "textureLod",
    "texelFetch",
    "textureSize",
    "textureGrad",
];

/// The loose uniforms and samplers a stage declares (in order), with the declarations removed.
struct Declared {
    body: String,
    values: Vec<(String, UniformType)>,
    samplers: Vec<(String, TexDim)>,
}

fn take_uniforms(src: &str) -> Result<Declared, String> {
    let mut body = String::with_capacity(src.len());
    let mut values = Vec::new();
    let mut samplers = Vec::new();
    for line in src.lines() {
        let t = line.trim_start();
        if t.starts_with("#version") || t.starts_with("precision ") {
            continue;
        }
        if let Some(rest) = t.strip_prefix("uniform ") {
            // `uniform [precision] type a, b, c; // comment`
            let decl = rest.split("//").next().unwrap_or("").trim();
            let decl = decl
                .strip_suffix(';')
                .ok_or_else(|| format!("A uniform is not on one line: {line}"))?;
            let mut words = decl
                .split_whitespace()
                .filter(|w| !matches!(*w, "highp" | "mediump" | "lowp"));
            let ty = words.next().ok_or("A uniform has no type")?;
            let names: String = words.collect::<Vec<_>>().join(" ");
            for name in names.split(',').map(str::trim).filter(|n| !n.is_empty()) {
                match ty {
                    "sampler2D" => samplers.push((name.to_owned(), TexDim::D2)),
                    "sampler3D" => samplers.push((name.to_owned(), TexDim::D3)),
                    other => {
                        let ty = UniformType::parse(other)
                            .ok_or_else(|| format!("Uniform type {other} is not supported"))?;
                        values.push((name.to_owned(), ty));
                    }
                }
            }
            continue;
        }
        body.push_str(line);
        body.push('\n');
    }
    Ok(Declared {
        body,
        values,
        samplers,
    })
}

/// std140 offsets for the block's fields, and its size.
pub fn std140(values: &[(String, UniformType)]) -> (Vec<UniformField>, usize) {
    let mut at = 0usize;
    let mut out = Vec::with_capacity(values.len());
    for (name, ty) in values {
        let (align, size) = ty.std140();
        at = at.div_ceil(align) * align;
        out.push(UniformField {
            name: name.clone(),
            ty: *ty,
            offset: at,
        });
        at += size;
    }
    (out, at.div_ceil(16) * 16)
}

/// Rewrite one stage's body: sampler types become texture types, and each
/// texture read gets the shared sampler.
fn rewrite_body(body: &str, dims: &HashMap<String, TexDim>) -> String {
    let toks = tokens(body);
    // Function parameters that are samplers (e.g. `sampler2D curve`) are textures too.
    let mut dims = dims.clone();
    for (i, t) in toks.iter().enumerate() {
        if let Tok::Ident(kind @ ("sampler2D" | "sampler3D")) = t {
            if let Some(j) = next_sig(&toks, i + 1) {
                if let Tok::Ident(name) = toks[j] {
                    dims.insert(
                        name.to_owned(),
                        if *kind == "sampler3D" {
                            TexDim::D3
                        } else {
                            TexDim::D2
                        },
                    );
                }
            }
        }
    }
    let mut out = String::with_capacity(body.len() + 256);
    let mut i = 0;
    while i < toks.len() {
        match &toks[i] {
            Tok::Ident("sampler2D") => out.push_str("texture2D"),
            Tok::Ident("sampler3D") => out.push_str("texture3D"),
            Tok::Ident(f) if TEXTURE_FUNCS.contains(f) => {
                out.push_str(f);
                // `texture ( name ,` → `texture(sampler2D(name, smp),`
                if let Some(open) = next_sig(&toks, i + 1).filter(|&j| toks[j] == Tok::Other("(")) {
                    if let Some(n) = next_sig(&toks, open + 1) {
                        if let Tok::Ident(name) = toks[n] {
                            if let Some(dim) = dims.get(name) {
                                let ctor = if *dim == TexDim::D3 {
                                    "sampler3D"
                                } else {
                                    "sampler2D"
                                };
                                let _ = write!(out, "({ctor}({name}, {SAMPLER_NAME})");
                                i = n + 1;
                                continue;
                            }
                        }
                    }
                }
            }
            Tok::Ident(s) | Tok::Other(s) => out.push_str(s),
        }
        i += 1;
    }
    out
}

/// Give each `in`/`out` at the top level a location (vertex inputs by their WebGL attribute names).
fn locate(body: &str, stage: Stage) -> String {
    let mut out = String::with_capacity(body.len() + 64);
    let (mut ins, mut outs) = (0u32, 0u32);
    for line in body.lines() {
        let t = line.trim_start();
        let is_in = t.starts_with("in ");
        let is_out = t.starts_with("out ");
        if (is_in || is_out) && t.ends_with(';') && !t.contains('(') {
            let loc = if is_in && stage == Stage::Vertex {
                if t.contains("aUv") {
                    1
                } else {
                    0
                }
            } else if is_in {
                ins += 1;
                ins - 1
            } else {
                outs += 1;
                outs - 1
            };
            let _ = writeln!(out, "layout(location = {loc}) {t}");
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Rename `void main()` and call it from a new `main` that turns Y over.
fn flip_vertex(body: &str) -> String {
    let renamed = body.replacen("void main()", "void lumora_main()", 1);
    format!("{renamed}\nvoid main() {{\n  lumora_main();\n  gl_Position.y = -gl_Position.y;\n}}\n")
}

/// Convert one WebGL program (vertex and fragment GLSL ES 3.00).
///
/// # Errors
/// A uniform the conversion doesn't understand.
pub fn convert(vs: &str, fs: &str) -> Result<Converted, String> {
    let v = take_uniforms(vs)?;
    let f = take_uniforms(fs)?;
    // One layout for both stages (the vertex programs have no uniforms today, but share if they do).
    let mut values = v.values.clone();
    for u in &f.values {
        if !values.iter().any(|x| x.0 == u.0) {
            values.push(u.clone());
        }
    }
    let mut samplers = v.samplers.clone();
    for s in &f.samplers {
        if !samplers.iter().any(|x| x.0 == s.0) {
            samplers.push(s.clone());
        }
    }
    let (uniforms, block_size) = std140(&values);
    let textures: Vec<TextureSlot> = samplers
        .iter()
        .zip(FIRST_TEXTURE_BINDING..)
        .map(|((name, dim), binding)| TextureSlot {
            name: name.clone(),
            dim: *dim,
            binding,
        })
        .collect();
    let dims: HashMap<String, TexDim> = samplers.iter().cloned().collect();

    let mut head = String::from("#version 450\n");
    if !uniforms.is_empty() {
        let _ = writeln!(
            head,
            "layout(std140, set = 0, binding = {UNIFORM_BINDING}) uniform {BLOCK_NAME} {{"
        );
        for u in &uniforms {
            let _ = writeln!(head, "  {} {};", u.ty.glsl(), u.name);
        }
        head.push_str("};\n");
    }
    if !textures.is_empty() {
        let _ = writeln!(
            head,
            "layout(set = 0, binding = {SAMPLER_BINDING}) uniform sampler {SAMPLER_NAME};"
        );
        for t in &textures {
            let kind = if t.dim == TexDim::D3 {
                "texture3D"
            } else {
                "texture2D"
            };
            let _ = writeln!(
                head,
                "layout(set = 0, binding = {}) uniform {kind} {};",
                t.binding, t.name
            );
        }
    }
    let vertex = format!(
        "{head}{}",
        flip_vertex(&locate(&rewrite_body(&v.body, &dims), Stage::Vertex))
    );
    let fragment = format!(
        "{head}{}",
        locate(&rewrite_body(&f.body, &dims), Stage::Fragment)
    );
    Ok(Converted {
        vertex,
        fragment,
        layout: Layout {
            uniforms,
            block_size,
            textures,
        },
    })
}

/// Parse and check a converted stage with naga.
///
/// # Errors
/// naga's message, with the source line it points at.
pub fn module(src: &str, stage: Stage) -> Result<naga::Module, String> {
    let st = match stage {
        Stage::Vertex => naga::ShaderStage::Vertex,
        Stage::Fragment => naga::ShaderStage::Fragment,
    };
    let mut front = naga::front::glsl::Frontend::default();
    let m = front
        .parse(&naga::front::glsl::Options::from(st), src)
        .map_err(|e| {
            let mut msg = String::new();
            for err in &e.errors {
                let at = err.meta.to_range().map_or(0, |r| r.start);
                let line = src[..at.min(src.len())].lines().count();
                let text = src.lines().nth(line.saturating_sub(1)).unwrap_or("");
                let _ = writeln!(msg, "{} (line {line}: {})", err.kind, text.trim());
            }
            msg
        })?;
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    )
    .validate(&m)
    .map_err(|e| format!("{:?}", e.into_inner()))?;
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn std140_offsets() {
        let v = vec![
            ("a".to_owned(), UniformType::Float),
            ("b".to_owned(), UniformType::Vec3),
            ("c".to_owned(), UniformType::Float),
            ("d".to_owned(), UniformType::Vec2),
            ("e".to_owned(), UniformType::Mat3),
            ("f".to_owned(), UniformType::Int),
        ];
        let (f, size) = std140(&v);
        let offs: Vec<usize> = f.iter().map(|x| x.offset).collect();
        // vec3 aligns to 16 but a float may sit in its last 4 bytes.
        assert_eq!(offs, vec![0, 16, 28, 32, 48, 96]);
        assert_eq!(size, 112);
    }

    #[test]
    fn puts_values_where_the_block_has_them() {
        let (uniforms, block_size) = std140(&[
            ("uMode".to_owned(), UniformType::Int),
            ("uH".to_owned(), UniformType::Mat3),
        ]);
        let l = Layout {
            uniforms,
            block_size,
            textures: vec![],
        };
        let mut b = vec![0u8; l.block_size];
        l.put(&mut b, "uMode", &[3.0]);
        l.put(&mut b, "uH", &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]);
        l.put(&mut b, "uNothing", &[1.0]);
        assert_eq!(i32::from_le_bytes(b[0..4].try_into().unwrap()), 3);
        let f = |at: usize| f32::from_le_bytes(b[at..at + 4].try_into().unwrap());
        assert_eq!((f(16), f(20), f(24)), (1.0, 2.0, 3.0));
        assert_eq!((f(32), f(36), f(40)), (4.0, 5.0, 6.0));
        assert_eq!((f(48), f(52), f(56)), (7.0, 8.0, 9.0));
    }

    #[test]
    fn texture_reads_get_the_sampler() {
        let fs = "#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 outColor;\nuniform sampler2D uTex, uB;\nuniform highp sampler3D uLut;\nuniform float uA, uC;\nvec3 f(sampler2D t) { return texture(t, vUv).rgb; }\nvoid main() { outColor = texture(uTex, vUv) + texture( uB ,vUv) + texture(uLut, vec3(uA)) + vec4(f(uB), uC); }\n";
        let c = convert("#version 300 es\nin vec2 aPos;\nout vec2 vUv;\nvoid main() { vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }", fs).unwrap();
        assert!(c
            .fragment
            .contains("texture(sampler2D(uTex, lumora_smp), vUv)"));
        assert!(c
            .fragment
            .contains("texture(sampler2D(uB, lumora_smp) ,vUv)"));
        assert!(c
            .fragment
            .contains("texture(sampler3D(uLut, lumora_smp), vec3(uA))"));
        assert!(c.fragment.contains(
            "vec3 f(texture2D t) { return texture(sampler2D(t, lumora_smp), vUv).rgb; }"
        ));
        assert!(c.fragment.contains("layout(location = 0) in vec2 vUv;"));
        assert_eq!(
            c.layout
                .textures
                .iter()
                .map(|t| t.binding)
                .collect::<Vec<_>>(),
            vec![2, 3, 4]
        );
        assert_eq!(c.layout.texture("uLut").unwrap().dim, TexDim::D3);
        assert!(c.vertex.contains("gl_Position.y = -gl_Position.y"));
        module(&c.vertex, Stage::Vertex).unwrap();
        module(&c.fragment, Stage::Fragment).unwrap();
    }
}
