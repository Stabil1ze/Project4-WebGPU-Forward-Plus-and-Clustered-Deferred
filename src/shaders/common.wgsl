// CHECKITOUT: code that you add here will be prepended to all shaders

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
