// Clustered Deferred shading pass
// One thread per pixel, replacing the vertex + fragment fullscreen pass: it reads the G-buffer,
// reconstructs the world position from the depth buffer, lights the pixel with the lights of its
// cluster and writes the result straight into the output texture.

@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterLightCounts: array<u32>;
@group(${bindGroup_scene}) @binding(3) var<storage, read> clusterLightIndices: array<u32>;

@group(${bindGroup_gbuffer}) @binding(0) var albedoTexture: texture_2d<f32>;
@group(${bindGroup_gbuffer}) @binding(1) var normalTexture: texture_2d<u32>;
@group(${bindGroup_gbuffer}) @binding(2) var depthTexture: texture_depth_2d;
@group(${bindGroup_gbuffer}) @binding(3) var outputTexture: texture_storage_2d<rgba8unorm, write>;

// Camera pixel -> world position, the inverse of what the G-buffer pass rasterised
fn worldPositionFromDepth(pixel: vec2u, depthNdc: f32) -> vec3f {
    let size = cameraUniforms.viewportSize;
    let ndc = vec3f(
        2.f * (f32(pixel.x) + 0.5f) / size.x - 1.f,
        1.f - 2.f * (f32(pixel.y) + 0.5f) / size.y,
        depthNdc
    );
    let worldHomogeneous = cameraUniforms.invViewProjMat * vec4f(ndc, 1.f);
    return worldHomogeneous.xyz / worldHomogeneous.w;
}

@compute
@workgroup_size(${shadingWorkgroupSize}, ${shadingWorkgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u)
{
    let viewportSize = vec2u(cameraUniforms.viewportSize);
    if (globalIdx.x >= viewportSize.x || globalIdx.y >= viewportSize.y) {
        return;
    }

    let texel = vec2i(globalIdx.xy);
    let albedo = textureLoad(albedoTexture, texel, 0).rgb;
    let normal = unpackNormalOctahedral(textureLoad(normalTexture, texel, 0).r);
    let depth = textureLoad(depthTexture, texel, 0);
    let worldPos = worldPositionFromDepth(globalIdx.xy, depth);

    // same lookup the Forward+ shader uses, with the pixel centre the rasteriser would have given
    let fragCoord = vec4f(vec2f(globalIdx.xy) + 0.5f, depth, 1.f);
    let clusterIdx = clusterIndexForFragment(fragCoord, cameraUniforms.viewportSize);
    let numLightsInCluster = clusterLightCounts[clusterIdx];
    let clusterBase = clusterIdx * maxLightsPerCluster;

    // walk only the lights in the cluster of this pixel
    var totalLightContrib = vec3f(0, 0, 0);
    for (var i = 0u; i < numLightsInCluster; i++) {
        let lightIdx = clusterLightIndices[clusterBase + i];
        let light = lightSet.lights[lightIdx];
        totalLightContrib += calculateLightContrib(light, worldPos, normal);
    }

    textureStore(outputTexture, texel, vec4f(albedo * totalLightContrib, 1.f));
}
