import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

// Clustered Deferred Renderer
// Uses the Forward+ light clustering as a base, but splits rendering into two passes: a G-buffer
// pass that stores albedo and the packed normal, and a compute shading pass that reads them back,
// reconstructs the world position from the depth buffer and lights every pixel exactly once.

export class ClusteredDeferredRenderer extends renderer.Renderer {
    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    albedoTexture: GPUTexture;
    normalTexture: GPUTexture;
    
    // G-buffer pass that stores albedo and the octahedral packed normal
    gbufferBindGroupLayout: GPUBindGroupLayout;
    gbufferSceneBindGroupLayout: GPUBindGroupLayout;
    gbufferSceneBindGroup: GPUBindGroup;
    gbufferPipeline: GPURenderPipeline;

    // Compute shading pass that reads the G-buffer and performs lighting
    shadingBindGroupLayout: GPUBindGroupLayout;
    shadingBindGroup: GPUBindGroup;
    shadingPipeline: GPUComputePipeline;

    constructor(stage: Stage) {
        super(stage);

        this.depthTexture = renderer.device.createTexture({
            label: "clustered deferred depth",
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.depthTextureView = this.depthTexture.createView();

        this.albedoTexture = this.createGBufferTexture("clustered deferred albedo", "rgba8unorm");
        // one u32 per pixel: two octahedral coordinates of 16 bits each
        this.normalTexture = this.createGBufferTexture("clustered deferred normal", "r32uint");

        // ---- G-buffer pass ----

        this.gbufferSceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "clustered deferred g-buffer scene bind group layout",
            entries: [
                { // cameraUniforms, read by the shared naive vertex shader
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.gbufferSceneBindGroup = renderer.device.createBindGroup({
            label: "clustered deferred g-buffer scene bind group",
            layout: this.gbufferSceneBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                }
            ]
        });

        this.gbufferPipeline = renderer.device.createRenderPipeline({
            label: "clustered deferred g-buffer pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "clustered deferred g-buffer pipeline layout",
                bindGroupLayouts: [
                    this.gbufferSceneBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout
                ]
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "clustered deferred g-buffer vert shader",
                    code: shaders.naiveVertSrc
                }),
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "clustered deferred g-buffer frag shader",
                    code: shaders.clusteredDeferredFragSrc
                }),
                targets: [
                    { format: "rgba8unorm" },
                    { format: "r32uint" }
                ]
            }
        });

        // ---- compute shading pass ----

        this.shadingBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "clustered deferred shading bind group layout",
            entries: [
                { // cameraUniforms, read for the viewport size used by the cluster lookup
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterLightCounts
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterLightIndices
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.shadingBindGroup = renderer.device.createBindGroup({
            label: "clustered deferred shading bind group",
            layout: this.shadingBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.lights.lightSetStorageBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: this.lights.clusterLightCountsBuffer }
                },
                {
                    binding: 3,
                    resource: { buffer: this.lights.clusterLightIndicesBuffer }
                }
            ]
        });

        this.gbufferBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "clustered deferred g-buffer bind group layout",
            entries: [
                { // albedo
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: "float" }
                },
                { // normal, two octahedral coordinates packed into a u32
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: "uint" }
                },
                { // depth
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: "depth" }
                },
                { // shaded output, written by the compute pass
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { access: "write-only", format: "rgba8unorm" }
                }
            ]
        });

        this.shadingPipeline = renderer.device.createComputePipeline({
            label: "clustered deferred shading compute pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "clustered deferred shading pipeline layout",
                bindGroupLayouts: [
                    this.shadingBindGroupLayout,
                    this.gbufferBindGroupLayout
                ]
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "clustered deferred shading compute shader",
                    code: shaders.clusteredDeferredShadingSrc
                }),
                entryPoint: "main"
            }
        });
    }
    
    // Helper function to create a G-buffer texture with the specified label and format
    private createGBufferTexture(label: string, format: GPUTextureFormat): GPUTexture {
        return renderer.device.createTexture({
            label,
            size: [renderer.canvas.width, renderer.canvas.height],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
    }

    // The canvas texture is a new texture every frame, so the bind group holding it is rebuilt each
    // frame; the G-buffer views on the other bindings never change.
    private createShadingBindGroup(output: GPUTextureView): GPUBindGroup {
        return renderer.device.createBindGroup({
            label: "clustered deferred shading bind group",
            layout: this.gbufferBindGroupLayout,
            entries: [
                { binding: 0, resource: this.albedoTexture.createView() },
                { binding: 1, resource: this.normalTexture.createView() },
                { binding: 2, resource: this.depthTextureView },
                { binding: 3, resource: output }
            ]
        });
    }
    
    // Overrided draw method that performs the clustered deferred rendering in two passes
    override draw() {
        const encoder = renderer.device.createCommandEncoder();

        this.lights.doLightClustering(encoder);

        const gbufferPass = encoder.beginRenderPass({
            label: "clustered deferred g-buffer pass",
            colorAttachments: [
                {
                    view: this.albedoTexture.createView(),
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {
                    view: this.normalTexture.createView(),
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });
        gbufferPass.setPipeline(this.gbufferPipeline);
        gbufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.gbufferSceneBindGroup);

        this.scene.iterate(node => {
            gbufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            gbufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            gbufferPass.setVertexBuffer(0, primitive.vertexBuffer);
            gbufferPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            gbufferPass.drawIndexed(primitive.numIndices);
        });

        gbufferPass.end();

        const shadingPass = encoder.beginComputePass({ label: "clustered deferred shading pass" });
        shadingPass.setPipeline(this.shadingPipeline);
        shadingPass.setBindGroup(shaders.constants.bindGroup_scene, this.shadingBindGroup);
        shadingPass.setBindGroup(
            shaders.constants.bindGroup_gbuffer,
            this.createShadingBindGroup(renderer.context.getCurrentTexture().createView())
        );
        shadingPass.dispatchWorkgroups(
            Math.ceil(renderer.canvas.width / shaders.constants.screenWorkgroupSize),
            Math.ceil(renderer.canvas.height / shaders.constants.screenWorkgroupSize)
        );
        shadingPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
