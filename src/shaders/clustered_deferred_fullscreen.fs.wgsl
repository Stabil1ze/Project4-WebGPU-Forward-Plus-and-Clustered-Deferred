// Shading pass
// Read from the G-buffer and apply lighting

@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterLightCounts: array<u32>;
@group(${bindGroup_scene}) @binding(3) var<storage, read> clusterLightIndices: array<u32>;

@group(${bindGroup_gbuffer}) @binding(0) var albedoTexture: texture_2d<f32>;
@group(${bindGroup_gbuffer}) @binding(1) var normalTexture: texture_2d<f32>;
@group(${bindGroup_gbuffer}) @binding(2) var positionTexture: texture_2d<f32>;
@group(${bindGroup_gbuffer}) @binding(3) var depthTexture: texture_depth_2d;

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f
{
    let texel = vec2i(fragCoord.xy);
    let albedo = textureLoad(albedoTexture, texel, 0).rgb;
    let normal = normalize(textureLoad(normalTexture, texel, 0).xyz);
    let worldPos = textureLoad(positionTexture, texel, 0).xyz;
    let depth = textureLoad(depthTexture, texel, 0);

    // Get the cluster index for this fragment
    let clusterIdx = clusterIndexForFragment(vec4f(fragCoord.xy, depth, 1.f), cameraUniforms.viewportSize);
    let numLightsInCluster = clusterLightCounts[clusterIdx];
    let clusterBase = clusterIdx * maxLightsPerCluster;
       
    // Walk only the lights in the cluster of this fragment
    var totalLightContrib = vec3f(0, 0, 0);
    for (var i = 0u; i < numLightsInCluster; i++) {
        let lightIdx = clusterLightIndices[clusterBase + i];
        let light = lightSet.lights[lightIdx];
        totalLightContrib += calculateLightContrib(light, worldPos, normal);
    }

    return vec4f(albedo * totalLightContrib, 1.f);
}
