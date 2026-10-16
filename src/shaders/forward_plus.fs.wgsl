// Forward+ shading
// Only walks the lights of the fragment's cluster compared to the naive renderer

@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterLightCounts: array<u32>;
@group(${bindGroup_scene}) @binding(3) var<storage, read> clusterLightIndices: array<u32>;
@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f
}

@fragment
fn main(in: FragmentInput, @builtin(position) fragCoord: vec4f) -> @location(0) vec4f
{
    let diffuseColor = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (diffuseColor.a < 0.5f) {
        discard;
    }

    // Get the cluster index for this fragment
    let clusterIdx = clusterIndexForFragment(fragCoord, cameraUniforms.viewportSize);
    let numLightsInCluster = clusterLightCounts[clusterIdx];
    let clusterBase = clusterIdx * maxLightsPerCluster;
    let normal = normalize(in.nor);

    // Walk only the lights in the cluster of this fragment
    var totalLightContrib = vec3f(0, 0, 0);
    for (var i = 0u; i < numLightsInCluster; i++) {
        let lightIdx = clusterLightIndices[clusterBase + i];
        let light = lightSet.lights[lightIdx];
        totalLightContrib += calculateLightContrib(light, in.pos, normal);
    }

    var finalColor = diffuseColor.rgb * totalLightContrib;
    return vec4(finalColor, 1);
}
