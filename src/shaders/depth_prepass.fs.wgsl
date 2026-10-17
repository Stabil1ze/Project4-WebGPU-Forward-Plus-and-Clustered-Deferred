// Depth prepass
// Render depth for forward+ renderer

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    // only the texture coordinate is needed here, so the other varyings stay uninterpolated
    @location(2) uv: vec2f
}

@fragment
fn main(in: FragmentInput)
{
    let diffuseColor = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (diffuseColor.a < 0.5f) {
        discard;
    }
}
