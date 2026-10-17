// Marks the clusters that contain visible geometry for light clustering to skip empty clusters

@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var depthTexture: texture_depth_2d;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> clusterActive: array<atomic<u32>>;

@compute
@workgroup_size(${screenWorkgroupSize}, ${screenWorkgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u)
{
    let viewportSize = vec2u(cameraUniforms.viewportSize);
    if (globalIdx.x >= viewportSize.x || globalIdx.y >= viewportSize.y) {
        return;
    }

    let depth = textureLoad(depthTexture, vec2i(globalIdx.xy), 0);
    if (depth >= 1.f) {
        return;
    }

    let fragCoord = vec4f(vec2f(globalIdx.xy) + 0.5f, depth, 1.f);
    let clusterIdx = clusterIndexForFragment(fragCoord, cameraUniforms.viewportSize);
    atomicStore(&clusterActive[clusterIdx], 1u);
}
