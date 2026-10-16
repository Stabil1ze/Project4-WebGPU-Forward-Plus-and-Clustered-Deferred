// Fullscreen pass
// Simply draws a fullscreen triangle, no vertex attributes needed

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f
{
    let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
    return vec4f(uv * 2.f - 1.f, 0.f, 1.f);
}
