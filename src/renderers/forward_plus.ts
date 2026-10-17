import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

// Forward+ with a depth prepass
// Use naive renderer as a base
export class ForwardPlusRenderer extends renderer.Renderer {
    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    sceneBindGroupLayout: GPUBindGroupLayout;
    sceneBindGroup: GPUBindGroup;

    prepassPipeline: GPURenderPipeline;
    shadingPipeline: GPURenderPipeline;

    clearBindGroupLayout: GPUBindGroupLayout;
    clearBindGroup: GPUBindGroup;
    clearPipeline: GPUComputePipeline;

    markBindGroupLayout: GPUBindGroupLayout;
    markBindGroup: GPUBindGroup;
    markPipeline: GPUComputePipeline;

    constructor(stage: Stage) {
        super(stage);

        this.depthTexture = renderer.device.createTexture({
            label: "forward+ depth prepass",
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            // TEXTURE_BINDING so the cluster marking pass can read the prepassed depth back
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.depthTextureView = this.depthTexture.createView();

        this.sceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "forward+ scene bind group layout",
            entries: [
                { // cameraUniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
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

        this.sceneBindGroup = renderer.device.createBindGroup({
            label: "forward+ scene bind group",
            layout: this.sceneBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterLightCountsBuffer } },
                { binding: 3, resource: { buffer: this.lights.clusterLightIndicesBuffer } }
            ]
        });

        const geometryPipelineLayout = renderer.device.createPipelineLayout({
            label: "forward+ geometry pipeline layout",
            bindGroupLayouts: [
                this.sceneBindGroupLayout,
                renderer.modelBindGroupLayout,
                renderer.materialBindGroupLayout
            ]
        });
        const geometryVertex = {
            module: renderer.device.createShaderModule({
                label: "forward+ geometry vert shader",
                code: shaders.naiveVertSrc
            }),
            buffers: [ renderer.vertexBufferLayout ]
        };

        this.prepassPipeline = renderer.device.createRenderPipeline({
            label: "forward+ depth prepass pipeline",
            layout: geometryPipelineLayout,
            // the prepass owns the depth buffer: it writes it and keeps the nearest fragment
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: geometryVertex,
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "forward+ depth prepass frag shader",
                    code: shaders.depthPrepassFragSrc
                }),
                targets: []
            }
        });

        this.shadingPipeline = renderer.device.createRenderPipeline({
            label: "forward+ shading pipeline",
            layout: geometryPipelineLayout,
            // only the fragments the prepass already kept are shaded, and none of them writes depth
            depthStencil: {
                depthWriteEnabled: false,
                depthCompare: "equal",
                format: "depth24plus"
            },
            vertex: geometryVertex,
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "forward+ frag shader",
                    code: shaders.forwardPlusFragSrc
                }),
                targets: [
                    { format: renderer.canvasFormat }
                ]
            }
        });

        this.clearBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "cluster active clear bind group layout",
            entries: [
                { // clusterActive
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                }
            ]
        });

        this.clearBindGroup = renderer.device.createBindGroup({
            label: "cluster active clear bind group",
            layout: this.clearBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.lights.clusterActiveBuffer } }
            ]
        });

        this.clearPipeline = renderer.device.createComputePipeline({
            label: "cluster active clear pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "cluster active clear pipeline layout",
                bindGroupLayouts: [ this.clearBindGroupLayout ]
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "cluster active clear shader",
                    code: shaders.clusterClearComputeSrc
                }),
                entryPoint: "main"
            }
        });

        this.markBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "cluster mark bind group layout",
            entries: [
                { // cameraUniforms
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                { // depth
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: "depth" }
                },
                { // clusterActive
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                }
            ]
        });

        this.markBindGroup = renderer.device.createBindGroup({
            label: "cluster mark bind group",
            layout: this.markBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: this.depthTextureView },
                { binding: 2, resource: { buffer: this.lights.clusterActiveBuffer } }
            ]
        });

        this.markPipeline = renderer.device.createComputePipeline({
            label: "cluster mark pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "cluster mark pipeline layout",
                bindGroupLayouts: [ this.markBindGroupLayout ]
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "cluster mark shader",
                    code: shaders.clusterMarkComputeSrc
                }),
                entryPoint: "main"
            }
        });
    }

    private drawGeometry(pass: GPURenderPassEncoder) {
        this.scene.iterate(node => {
            pass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            pass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            pass.setVertexBuffer(0, primitive.vertexBuffer);
            pass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            pass.drawIndexed(primitive.numIndices);
        });
    }

    override draw() {
        const encoder = renderer.device.createCommandEncoder();

        const clearPass = encoder.beginComputePass({ label: "cluster active clear pass" });
        clearPass.setPipeline(this.clearPipeline);
        clearPass.setBindGroup(shaders.constants.bindGroup_scene, this.clearBindGroup);
        clearPass.dispatchWorkgroups(Math.ceil(shaders.constants.numClusters / shaders.constants.clusterClearWorkgroupSize));
        clearPass.end();

        const prepass = encoder.beginRenderPass({
            label: "forward+ depth prepass",
            colorAttachments: [],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });
        prepass.setPipeline(this.prepassPipeline);
        prepass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneBindGroup);
        this.drawGeometry(prepass);
        prepass.end();

        const markPass = encoder.beginComputePass({ label: "cluster active mark pass" });
        markPass.setPipeline(this.markPipeline);
        markPass.setBindGroup(shaders.constants.bindGroup_scene, this.markBindGroup);
        markPass.dispatchWorkgroups(
            Math.ceil(renderer.canvas.width / shaders.constants.screenWorkgroupSize),
            Math.ceil(renderer.canvas.height / shaders.constants.screenWorkgroupSize)
        );
        markPass.end();

        this.lights.doLightClustering(encoder, true);

        const shadingPass = encoder.beginRenderPass({
            label: "forward+ shading pass",
            colorAttachments: [
                {
                    view: renderer.context.getCurrentTexture().createView(),
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthLoadOp: "load",
                depthStoreOp: "discard"
            }
        });
        shadingPass.setPipeline(this.shadingPipeline);
        shadingPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneBindGroup);
        this.drawGeometry(shadingPass);
        shadingPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
