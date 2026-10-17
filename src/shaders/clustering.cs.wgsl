// Builds the light clusters consumed by the Forward+ and Clustered Deferred renderers

@group(${bindGroup_scene}) @binding(0) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(1) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> clusterLightCounts: array<u32>;
@group(${bindGroup_scene}) @binding(3) var<storage, read_write> clusterLightIndices: array<u32>;
@group(${bindGroup_scene}) @binding(4) var<storage, read> clusterActive: array<u32>;

// Switcher for culling inactive clusters
// Forward+: 1u, Clustered Deferred: 0u
override cullInactiveClusters: u32 = 0u;

// World-space AABB of the frustum cell of cluster
fn clusterAABB(tileX: u32, tileY: u32, sliceZ: u32) -> array<vec3f, 2> {
    let ndcMin = vec3f(
        2.f * f32(tileX) / f32(numClusterTilesX) - 1.f,
        2.f * f32(tileY) / f32(numClusterTilesY) - 1.f,
        depthFromViewDistance(clusterZSliceNear(sliceZ))
    );
    let ndcMax = vec3f(
        2.f * f32(tileX + 1u) / f32(numClusterTilesX) - 1.f,
        2.f * f32(tileY + 1u) / f32(numClusterTilesY) - 1.f,
        depthFromViewDistance(clusterZSliceFar(sliceZ))
    );

    // Compute the world-space AABB by transforming the 8 corners of the frustum cell from NDC to world space
    var aabb = array<vec3f, 2>(vec3f(1e30f), vec3f(-1e30f));
    for (var corner = 0u; corner < 8u; corner = corner + 1u) {
        let ndc = vec3f(
            select(ndcMin.x, ndcMax.x, (corner & 1u) != 0u),
            select(ndcMin.y, ndcMax.y, (corner & 2u) != 0u),
            select(ndcMin.z, ndcMax.z, (corner & 4u) != 0u)
        );
        let worldHomogeneous = cameraUniforms.invViewProjMat * vec4f(ndc, 1.f);
        let world = worldHomogeneous.xyz / worldHomogeneous.w;
        aabb[0] = min(aabb[0], world);
        aabb[1] = max(aabb[1], world);
    }
    return aabb;
}

@compute
@workgroup_size(${clusteringWorkgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u) {
    let clusterIdx = globalIdx.x;
    if (clusterIdx >= numClusters) {
        return;
    }

    // inverse of clusterIndex()
    let tileX = clusterIdx % numClusterTilesX;
    let tileY = (clusterIdx / numClusterTilesX) % numClusterTilesY;
    let sliceZ = clusterIdx / (numClusterTilesX * numClusterTilesY);

    // clusters the depth precull left without visible geometry get an empty light list
    if (cullInactiveClusters == 1u && clusterActive[clusterIdx] == 0u) {
        clusterLightCounts[clusterIdx] = 0u;
        return;
    }

    let aabb = clusterAABB(tileX, tileY, sliceZ);
    let aabbMin = aabb[0];
    let aabbMax = aabb[1];

    let numLights = lightSet.numLights;
    let radiusSquared = ${lightRadius}f * ${lightRadius}f;
    let base = clusterIdx * maxLightsPerCluster;

    // Count the number of lights affecting this cluster and store their indices
    var count = 0u;
    for (var lightIdx = 0u; lightIdx < numLights; lightIdx = lightIdx + 1u) {
        if (count >= maxLightsPerCluster) {
            break;
        }
        // Check if the light's sphere intersects the cluster's AABB
        // If so, add the light's index to clusterLightIndices and increment the count
        let lightPos = lightSet.lights[lightIdx].pos;
        let delta = lightPos - clamp(lightPos, aabbMin, aabbMax);
        if (dot(delta, delta) <= radiusSquared) {
            clusterLightIndices[base + count] = lightIdx;
            count = count + 1u;
        }
    }

    clusterLightCounts[clusterIdx] = count;
}
