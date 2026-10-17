// CHECKITOUT: this file loads all the shaders and preprocesses them with some common code

import { Camera } from '../stage/camera';

import commonRaw from './common.wgsl?raw';

import naiveVertRaw from './naive.vs.wgsl?raw';
import naiveFragRaw from './naive.fs.wgsl?raw';

import forwardPlusFragRaw from './forward_plus.fs.wgsl?raw';

import clusteredDeferredFragRaw from './clustered_deferred.fs.wgsl?raw';
import clusteredDeferredShadingRaw from './clustered_deferred_shading.cs.wgsl?raw';

import depthPrepassFragRaw from './depth_prepass.fs.wgsl?raw';
import clusterClearComputeRaw from './cluster_clear.cs.wgsl?raw';
import clusterMarkComputeRaw from './cluster_mark.cs.wgsl?raw';

import moveLightsComputeRaw from './move_lights.cs.wgsl?raw';
import clusteringComputeRaw from './clustering.cs.wgsl?raw';

import clusterDebugFragRaw from './cluster_debug.fs.wgsl?raw';

// CONSTANTS FOR SHADERS
// =================================

export const constants = {
    bindGroup_scene: 0,
    bindGroup_model: 1,
    bindGroup_material: 2,
    bindGroup_gbuffer: 1, // the G-buffer textures the Clustered Deferred shading pass reads

    moveLightsWorkgroupSize: 128,

    lightRadius: 2,

    // light clustering
    clusteringWorkgroupSize: 64,
    screenWorkgroupSize: 8,
    clusterClearWorkgroupSize: 64,
    numClusterTilesX: 16,
    numClusterTilesY: 16,
    numClusterZ: 24,
    numClusters: 16 * 16 * 24,
    maxLightsPerCluster: 512,

    // camera planes
    clusterNear: Camera.nearPlane,
    clusterFar: 100,
    cameraNear: Camera.nearPlane,
    cameraFar: Camera.farPlane
};

// =================================

function evalShaderRaw(raw: string) {
    // replace ${name} with the value of constants.name
    return raw.replace(/\$\{(\w+)\}/g, (_, name: string) => {
        const value = (constants as Record<string, unknown>)[name];
        if (value === undefined) {
            throw new Error(`unknown shader constant: ${name}`);
        }
        return String(value);
    });
}

const commonSrc: string = evalShaderRaw(commonRaw);

function processShaderRaw(raw: string) {
    return commonSrc + evalShaderRaw(raw);
}

export const naiveVertSrc: string = processShaderRaw(naiveVertRaw);
export const naiveFragSrc: string = processShaderRaw(naiveFragRaw);

export const forwardPlusFragSrc: string = processShaderRaw(forwardPlusFragRaw);

export const clusteredDeferredFragSrc: string = processShaderRaw(clusteredDeferredFragRaw);
export const clusteredDeferredShadingSrc: string = processShaderRaw(clusteredDeferredShadingRaw);

export const depthPrepassFragSrc: string = processShaderRaw(depthPrepassFragRaw);
export const clusterClearComputeSrc: string = processShaderRaw(clusterClearComputeRaw);
export const clusterMarkComputeSrc: string = processShaderRaw(clusterMarkComputeRaw);

export const moveLightsComputeSrc: string = processShaderRaw(moveLightsComputeRaw);
export const clusteringComputeSrc: string = processShaderRaw(clusteringComputeRaw);

export const clusterDebugFragSrc: string = processShaderRaw(clusterDebugFragRaw);
