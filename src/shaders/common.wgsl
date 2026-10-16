// Common shader code shared between all shaders

struct Light {
    pos: vec3f,
    color: vec3f
}

struct LightSet {
    numLights: u32,
    lights: array<Light>
}

// ------------------------------------
// Light clustering
// ------------------------------------

const numClusterTilesX: u32 = ${numClusterTilesX}u;
const numClusterTilesY: u32 = ${numClusterTilesY}u;
const numClusterZ: u32 = ${numClusterZ}u;
const numClusters: u32 = ${numClusters}u;
const maxLightsPerCluster: u32 = ${maxLightsPerCluster}u;

const clusterNear: f32 = ${clusterNear}f;
const clusterFar: f32 = ${clusterFar}f;

// Match the camera's near/far planes
const cameraNear: f32 = ${cameraNear}f;
const cameraFar: f32 = ${cameraFar}f;

// Returns the index of the cluster containing the given tile coordinates and depth slice
fn clusterIndex(tileX: u32, tileY: u32, sliceZ: u32) -> u32 {
    return (sliceZ * numClusterTilesY + tileY) * numClusterTilesX + tileX;
}

// View distance of the near bound of depth slice sliceZ
fn clusterZSliceNear(sliceZ: u32) -> f32 {
    return clusterNear * pow(clusterFar / clusterNear, f32(sliceZ) / f32(numClusterZ));
}

// View distance of the far bound of depth slice sliceZ
fn clusterZSliceFar(sliceZ: u32) -> f32 {
    if (sliceZ >= numClusterZ - 1u) {
        return cameraFar;
    }
    return clusterZSliceNear(sliceZ + 1u);
}

// View distance corresponding to a given NDC depth value
// Inverse of depthFromViewDistance
fn viewDistanceFromDepth(depthNdc: f32) -> f32 {
    return cameraFar * cameraNear / (cameraFar - depthNdc * (cameraFar - cameraNear));
}

// NDC depth value for a given view distance
// Inverse of viewDistanceFromDepth
fn depthFromViewDistance(viewDistance: f32) -> f32 {
    let range = cameraFar - cameraNear;
    return cameraFar / range - (cameraFar * cameraNear / range) / viewDistance;
}

// Index of the depth slice containing the given view distance
// Inverse of clusterZSliceNear/Far
fn clusterZIndex(viewDistance: f32) -> u32 {
    if (viewDistance <= clusterNear) {
        return 0u;
    }
    let t = log(viewDistance / clusterNear) / log(clusterFar / clusterNear);
    return min(u32(t * f32(numClusterZ)), numClusterZ - 1u);
}

// Index of the cluster containing the given fragment coordinates and depth
// Inverse of clusterIndex
fn clusterIndexForFragment(fragCoord: vec4f, viewportSize: vec2f) -> u32 {
    let tileX = min(u32(fragCoord.x * f32(numClusterTilesX) / viewportSize.x), numClusterTilesX - 1u);
    let tileY = numClusterTilesY - 1u - min(u32(fragCoord.y * f32(numClusterTilesY) / viewportSize.y), numClusterTilesY - 1u);
    return clusterIndex(tileX, tileY, clusterZIndex(viewDistanceFromDepth(fragCoord.z)));
}

struct CameraUniforms {
    viewProjMat: mat4x4f,
    invViewProjMat: mat4x4f,
    viewportSize: vec2f,
    padding: vec2f,
}

// ------------------------------------
// Octahedral normal encoding
// ------------------------------------

fn octahedralWrap(v: vec2f) -> vec2f {
    return (1.f - abs(v.yx)) * vec2f(select(-1.f, 1.f, v.x >= 0.f), select(-1.f, 1.f, v.y >= 0.f));
}

// Packs a normalized vector into a 32-bit unsigned integer using octahedral encoding
fn packNormalOctahedral(n: vec3f) -> u32 {
    let projected = n / (abs(n.x) + abs(n.y) + abs(n.z));
    let oct = select(octahedralWrap(projected.xy), projected.xy, projected.z >= 0.f);
    let quantised = vec2i(round(clamp(oct, vec2f(-1.f), vec2f(1.f)) * 32767.f));
    return (u32(quantised.x) & 0xFFFFu) | ((u32(quantised.y) & 0xFFFFu) << 16u);
}

// sign extends the low 16 bits of v and returns them as a float in [-1, 1]
fn signExtendNormalComponent(v: u32) -> f32 {
    let bits = v & 0xFFFFu;
    return f32(i32(bits) - select(0, 65536, bits >= 0x8000u)) / 32767.f;
}

fn unpackNormalOctahedral(packed: u32) -> vec3f {
    var n = vec3f(signExtendNormalComponent(packed), signExtendNormalComponent(packed >> 16u), 0.f);
    n.z = 1.f - abs(n.x) - abs(n.y);
    let fold = max(-n.z, 0.f);
    n.x += select(fold, -fold, n.x >= 0.f);
    n.y += select(fold, -fold, n.y >= 0.f);
    return normalize(n);
}

// CHECKITOUT: this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 {
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / (distance * distance);
}

fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let lambert = max(dot(nor, normalize(vecToLight)), 0.f);
    return light.color * lambert * rangeAttenuation(distToLight);
}
