import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

// Clustered Deferred Renderer
// Uses the Forward+ light clustering as a base, but splits rendering into two passes

export class ClusteredDeferredRenderer extends renderer.Renderer {
    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    albedoTexture: GPUTexture;
    normalTexture: GPUTexture;
    positionTexture: GPUTexture;
    
    // G-buffer pass that stores albedo, normal, and position
    gbufferBindGroupLayout: GPUBindGroupLayout;
    gbufferBindGroup: GPUBindGroup;
    gbufferSceneBindGroupLayout: GPUBindGroupLayout;
    gbufferSceneBindGroup: GPUBindGroup;
    gbufferPipeline: GPURenderPipeline;

    // Fullscreen shading pass that reads the G-buffer and performs lighting
    shadingBindGroupLayout: GPUBindGroupLayout;
    shadingBindGroup: GPUBindGroup;
    shadingPipeline: GPURenderPipeline;

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
        this.normalTexture = this.createGBufferTexture("clustered deferred normal", "rgba16float");
        this.positionTexture = this.createGBufferTexture("clustered deferred position", "rgba32float");

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
                    { format: "rgba16float" },
                    { format: "rgba32float" }
                ]
            }
        });

        // ---- fullscreen shading pass ----

        this.shadingBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "clustered deferred shading bind group layout",
            entries: [
                { // cameraUniforms, read for the viewport size used by the cluster lookup
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterLightCounts
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterLightIndices
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
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
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                { // normal
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                { // position
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                { // depth
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "depth" }
                }
            ]
        });

        this.gbufferBindGroup = renderer.device.createBindGroup({
            label: "clustered deferred g-buffer bind group",
            layout: this.gbufferBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.albedoTexture.createView()
                },
                {
                    binding: 1,
                    resource: this.normalTexture.createView()
                },
                {
                    binding: 2,
                    resource: this.positionTexture.createView()
                },
                {
                    binding: 3,
                    resource: this.depthTextureView
                }
            ]
        });

        this.shadingPipeline = renderer.device.createRenderPipeline({
            label: "clustered deferred shading pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "clustered deferred shading pipeline layout",
                bindGroupLayouts: [
                    this.shadingBindGroupLayout,
                    this.gbufferBindGroupLayout
                ]
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "clustered deferred fullscreen vert shader",
                    code: shaders.clusteredDeferredFullscreenVertSrc
                })
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "clustered deferred fullscreen frag shader",
                    code: shaders.clusteredDeferredFullscreenFragSrc
                }),
                targets: [
                    { format: renderer.canvasFormat }
                ]
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
                },
                {
                    view: this.positionTexture.createView(),
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

        const shadingPass = encoder.beginRenderPass({
            label: "clustered deferred shading pass",
            colorAttachments: [
                {
                    view: renderer.context.getCurrentTexture().createView(),
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ]
        });
        shadingPass.setPipeline(this.shadingPipeline);
        shadingPass.setBindGroup(shaders.constants.bindGroup_scene, this.shadingBindGroup);
        shadingPass.setBindGroup(shaders.constants.bindGroup_gbuffer, this.gbufferBindGroup);
        shadingPass.draw(3);
        shadingPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
