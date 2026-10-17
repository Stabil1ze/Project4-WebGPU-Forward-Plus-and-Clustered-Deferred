// Clear active cluster flags for the next frame

@group(${bindGroup_scene}) @binding(0) var<storage, read_write> clusterActive: array<atomic<u32>>;

@compute
@workgroup_size(${clusterClearWorkgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u)
{
    if (globalIdx.x >= numClusters) {
        return;
    }
    atomicStore(&clusterActive[globalIdx.x], 0u);
}
