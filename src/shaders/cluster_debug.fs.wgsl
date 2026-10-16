// Debug view: tints every fragment by the number of lights in the cluster it falls into.
// It reuses the naive geometry pass (see NaiveRenderer) and replaces only the fragment shader, so
// what it shows is the cluster lookup the Forward+ renderer will rely on.

@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterLightCounts: array<u32>;

// blue -> cyan -> green -> yellow -> red
fn heatmap(t: f32) -> vec3f {
    let x = clamp(t, 0.f, 1.f) * 4.f;
    if (x < 1.f) { return mix(vec3f(0.f, 0.f, 1.f), vec3f(0.f, 1.f, 1.f), x); }
    if (x < 2.f) { return mix(vec3f(0.f, 1.f, 1.f), vec3f(0.f, 1.f, 0.f), x - 1.f); }
    if (x < 3.f) { return mix(vec3f(0.f, 1.f, 0.f), vec3f(1.f, 1.f, 0.f), x - 2.f); }
    return mix(vec3f(1.f, 1.f, 0.f), vec3f(1.f, 0.f, 0.f), x - 3.f);
}

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    let clusterIdx = clusterIndexForFragment(fragCoord, cameraUniforms.viewportSize);
    let count = clusterLightCounts[clusterIdx];

    // 64 lights per cluster already saturates the colour ramp
    return vec4f(heatmap(f32(count) / 64.f), 1.f);
}
