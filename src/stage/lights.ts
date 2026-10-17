import { vec3 } from "wgpu-matrix";
import { device } from "../renderer";

import * as shaders from '../shaders/shaders';
import { Camera } from "./camera";

// h in [0, 1]
function hueToRgb(h: number) {
    let f = (n: number, k = (n + h * 6) % 6) => 1 - Math.max(Math.min(k, 4 - k, 1), 0);
    return vec3.lerp(vec3.create(1, 1, 1), vec3.create(f(5), f(3), f(1)), 0.8);
}

export class Lights {
    private camera: Camera;

    numLights = 500;
    static readonly maxNumLights = 5000;
    static readonly numFloatsPerLight = 8; // vec3f is aligned at 16 byte boundaries

    static readonly lightIntensity = 0.1;

    lightsArray = new Float32Array(Lights.maxNumLights * Lights.numFloatsPerLight);
    lightSetStorageBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    moveLightsComputeBindGroupLayout: GPUBindGroupLayout;
    moveLightsComputeBindGroup: GPUBindGroup;
    moveLightsComputePipeline: GPUComputePipeline;

    clusterLightCountsBuffer: GPUBuffer;
    clusterLightIndicesBuffer: GPUBuffer;
    clusterActiveBuffer: GPUBuffer;

    clusteringBindGroupLayout: GPUBindGroupLayout;
    clusteringBindGroup: GPUBindGroup;
    clusteringPipeline: GPUComputePipeline;
    clusteringPipelineCulled: GPUComputePipeline;

    constructor(camera: Camera) {
        this.camera = camera;

        this.lightSetStorageBuffer = device.createBuffer({
            label: "lights",
            size: 16 + this.lightsArray.byteLength, // 16 for numLights + padding
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this.populateLightsBuffer();
        this.updateLightSetUniformNumLights();

        this.timeUniformBuffer = device.createBuffer({
            label: "time uniform",
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.moveLightsComputeBindGroupLayout = device.createBindGroupLayout({
            label: "move lights compute bind group layout",
            entries: [
                { // lightSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // time
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.moveLightsComputeBindGroup = device.createBindGroup({
            label: "move lights compute bind group",
            layout: this.moveLightsComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.lightSetStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer }
                }
            ]
        });

        this.moveLightsComputePipeline = device.createComputePipeline({
            label: "move lights compute pipeline",
            layout: device.createPipelineLayout({
                label: "move lights compute pipeline layout",
                bindGroupLayouts: [ this.moveLightsComputeBindGroupLayout ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "move lights compute shader",
                    code: shaders.moveLightsComputeSrc
                }),
                entryPoint: "main"
            }
        });

        // COPY_SRC on the cluster buffers is only needed to read them back for debugging/verification
        this.clusterLightCountsBuffer = device.createBuffer({
            label: "cluster light counts",
            size: shaders.constants.numClusters * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.clusterLightIndicesBuffer = device.createBuffer({
            label: "cluster light indices",
            size: shaders.constants.numClusters * shaders.constants.maxLightsPerCluster * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });

        // one flag per cluster, set by the Forward+ depth precull and only read by the pipeline that
        // was built with cullInactiveClusters = 1
        this.clusterActiveBuffer = device.createBuffer({
            label: "cluster active flags",
            size: shaders.constants.numClusters * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });

        this.clusteringBindGroupLayout = device.createBindGroupLayout({
            label: "light clustering bind group layout",
            entries: [
                { // lightSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                { // cameraUniforms
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                { // clusterLightCounts
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // clusterLightIndices
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // clusterActive
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.clusteringBindGroup = device.createBindGroup({
            label: "light clustering bind group",
            layout: this.clusteringBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.lightSetStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: this.clusterLightCountsBuffer }
                },
                {
                    binding: 3,
                    resource: { buffer: this.clusterLightIndicesBuffer }
                },
                {
                    binding: 4,
                    resource: { buffer: this.clusterActiveBuffer }
                }
            ]
        });

        const clusteringPipelineLayout = device.createPipelineLayout({
            label: "light clustering compute pipeline layout",
            bindGroupLayouts: [ this.clusteringBindGroupLayout ]
        });
        const clusteringModule = device.createShaderModule({
            label: "light clustering compute shader",
            code: shaders.clusteringComputeSrc
        });
        const createClusteringPipeline = (label: string, cullInactiveClusters: number) =>
            device.createComputePipeline({
                label,
                layout: clusteringPipelineLayout,
                compute: {
                    module: clusteringModule,
                    entryPoint: "main",
                    constants: { cullInactiveClusters }
                }
            });

        this.clusteringPipeline = createClusteringPipeline("light clustering compute pipeline", 0);
        this.clusteringPipelineCulled = createClusteringPipeline("light clustering compute pipeline (culled)", 1);
    }

    private populateLightsBuffer() {
        for (let lightIdx = 0; lightIdx < Lights.maxNumLights; ++lightIdx) {
            // light pos is set by compute shader so no need to set it here
            const lightColor = vec3.scale(hueToRgb(Math.random()), Lights.lightIntensity);
            this.lightsArray.set(lightColor, (lightIdx * Lights.numFloatsPerLight) + 4);
        }

        device.queue.writeBuffer(this.lightSetStorageBuffer, 16, this.lightsArray);
    }

    updateLightSetUniformNumLights() {
        device.queue.writeBuffer(this.lightSetStorageBuffer, 0, new Uint32Array([this.numLights]));
    }

    doLightClustering(encoder: GPUCommandEncoder, cullInactiveClusters = false) {
        // implemented here so that Forward+ and Clustered Deferred share the same clustering
        const computePass = encoder.beginComputePass({ label: "light clustering pass" });
        computePass.setPipeline(cullInactiveClusters ? this.clusteringPipelineCulled : this.clusteringPipeline);
        computePass.setBindGroup(shaders.constants.bindGroup_scene, this.clusteringBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(shaders.constants.numClusters / shaders.constants.clusteringWorkgroupSize));
        computePass.end();
    }

    // CHECKITOUT: this is where the light movement compute shader is dispatched from the host
    onFrame(time: number) {
        device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

        // not using same encoder as render pass so this doesn't interfere with measuring actual rendering performance
        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.moveLightsComputePipeline);

        computePass.setBindGroup(0, this.moveLightsComputeBindGroup);

        const workgroupCount = Math.ceil(this.numLights / shaders.constants.moveLightsWorkgroupSize);
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        device.queue.submit([encoder.finish()]);
    }
}
