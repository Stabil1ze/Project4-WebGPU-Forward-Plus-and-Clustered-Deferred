# WebGPU Forward+ and Clustered Deferred Shading

**University of Pennsylvania, CIS 5650: GPU Programming and Architecture,
Project 4 - WebGPU Forward+ and Clustered Deferred Shading**

* **Jing Huang**
  * [GitHub](https://github.com/Stabil1ze)
* Tested on: Windows 11, Intel i7-12700H @ 2.30GHz, 32GB,
  NVIDIA GeForce RTX 3060 Laptop GPU 6GB

> **Declaration of AI assistance.** In line with the course's policy on AI
> tools: the analysis text of this README, the benchmark harness and the demo
> video were drafted with the help of Codex. Every number below is produced by
> code in this repository and can be reproduced with the harness described in
> the performance section. The implementation, the design decisions and the
> readings of the results were reviewed and accepted by the author, who is
> responsible for their correctness.

### Live Demo

[![](img/thumb.jpg)](https://stabil1ze.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred/)

### Demo Video

[![demo video](img/preview.gif)](img/demo.mp4)

[img/demo.mp4](img/demo.mp4) is 32 seconds at 1280x800. It starts with naive at 500 and at 5000
lights, then shows Forward+ at 5000 lights twice along the same camera path - without and with the
depth prepass - then the cluster debug view at 500 lights and Clustered Deferred at 5000 lights. The
caption at the top of each clip is the frame rate measured in the page while that clip was recorded.

## What is implemented

The scene is the Sponza atrium with up to 5000 moving point lights. The GUI
switches between four renderers:

| Mode | |
|---|---|
| **Naive** | Every fragment loops over every light in the scene. |
| **Forward+** | 16 x 16 screen tiles x 24 exponentially spaced depth slices (6144 clusters); each fragment walks only the lights of its own cluster. A depth prepass feeds the clustering and the shading pass, so every visible fragment is shaded once. |
| **Clustered Deferred** | The same clustering, split into a G-buffer pass and a compute shading pass so every pixel is lit exactly once. |
| **Cluster debug** | Tints every fragment by the number of lights in its cluster. |

The Clustered Deferred G-buffer is a single colour output plus one `u32` per
pixel - 8 bytes per pixel, plus depth:

| Target | Format | Bytes | Content |
|---|---|---|---|
| albedo | `rgba8unorm` | 4 | diffuse colour |
| normal | `r32uint` | 4 | octahedral normal, two 16-bit components packed into one `u32` |
| depth | `depth24plus` | 4 | depth testing, the cluster lookup and world position reconstruction |

World position is not stored: the shading pass recovers it from the depth
buffer and the inverse view-projection matrix. The shading pass is a compute
shader (8 x 8 workgroups, one thread per pixel) that writes straight into the
canvas, replacing the vertex + fragment fullscreen pass.

## Screenshots

| Forward+, 2000 lights | Clustered Deferred, 2000 lights |
|---|---|
| ![](img/forward_plus.jpg) | ![](img/clustered_deferred.jpg) |

*Both clustered renderers, same frozen light configuration. The two images are
identical apart from G-buffer quantisation.*

| Naive, 500 lights | Cluster debug, 500 lights |
|---|---|
| ![](img/naive.jpg) | ![](img/cluster_debug.jpg) |

*The debug view shows the 16 x 16 tile grid and the depth banding, and is how
the cluster lookup was checked.*

## Performance

Frame times are the mean of `requestAnimationFrame` intervals over 20-180
frames, measured in headless Chrome 154 at a 2560x1600 render target with the
light animation pinned to a fixed moment so that every mode shades the identical
scene. The browser presents at 165 Hz, so individual frames quantise to 6.06 ms
and 6.1 ms means that no frame missed a present. Means are reported instead of
medians because a configuration that sits on the refresh floor has a median
that jumps between 6.1 and 12.1 ms.

![](img/perf_frame_time.png)

| Frame time (ms) | 100 | 500 | 1000 | 2000 | 5000 |
|---|---|---|---|---|---|
| Naive | 23.7 | 116.1 | 231.8 | 464.9 | 1168.9 |
| Forward+ (no depth prepass) | 6.1 | 7.5 | 31.7 | 31.9 | 32.8 |
| Forward+ | 6.1 | 6.1 | 11.7 | 12.1 | 13.1 |
| Clustered Deferred | 6.1 | 6.1 | 8.6 | 9.3 | 10.0 |

![](img/perf_forward_vs_deferred.png)

* Naive scales linearly with the light count, from 24 ms at 100 lights to
  1169 ms at 5000.
* Forward+ is flat at 32 ms from 1000 to 5000 lights before the depth prepass
  and at 12-13 ms after it, while the light count quintuples.
* Clustered Deferred stays at 9-10 ms over the same range, so the depth prepass
  brings Forward+ from 3.3-3.7x behind Clustered Deferred to within 1.3-1.4x of it.
* Both cluster lists saturate at 186 of the 6144 clusters hitting the 512 lights
  per cluster cap.

### Depth prepass

Forward+ renders the scene to a depth-only prepass first, then shades with
`depthCompare: "equal"` and no depth write, so every visible fragment is shaded
once. The same depth buffer marks which clusters hold visible geometry, and
only those clusters are clustered.

| Forward+ | 1000 | 2000 | 5000 |
|---|---|---|---|
| Before the prepass | 31.7 | 31.9 | 32.8 |
| After the prepass | 11.7 | 12.1 | 13.1 |

Both builds are drawn on the two charts above.

504 of the 6144 clusters hold visible geometry, so depth-based culling removes
91.8% of the per-cluster light scans. The clustering pass was not the
bottleneck: with culling turned off the frame time moves by less than 0.5 ms
over 1000-5000 lights.

### G-buffer optimisation

The G-buffer was cut from three targets (albedo `rgba8unorm`, normal
`rgba16float`, position `rgba32float`, 28 bytes per pixel) to one colour output
plus one `u32` (8 bytes per pixel), by storing the normal octahedrally packed
and reconstructing the position from depth, and the fullscreen fragment pass
was replaced by the compute pass.

| Frame time (ms, median, measured before the depth prepass) | 500 | 1000 | 2000 | 5000 |
|---|---|---|---|---|
| Before (28 B/px, fullscreen pass) | 6.1 | 12.1 | 12.1 | 12.3 |
| After (8 B/px, compute pass) | 6.1 | 12.1 | 12.1 | 12.3 |

Both were measured in the same session. The frame time does not move: at this
resolution the deferred path is not limited by G-buffer traffic. The G-buffer
write traffic drops from 118 MB to 33 MB per frame at 2560x1600.

## Correctness

Both clustered renderers were compared against the naive renderer pixel by
pixel, with the lights frozen so that every mode shades the identical scene
(1280x800, 2000 lights):

| Comparison | Result |
|---|---|
| naive vs naive (control) | 0 differing pixels |
| naive vs Forward+ | 189 pixels (0.0185%) differ by up to 239 levels, on surfaces where two primitives share a depth |
| naive vs Clustered Deferred | 36% of pixels differ, 99.7% of those by a single level; mean channel error 0.148 |

The clustering was additionally checked against an independent CPU
implementation of the same maths: all 6144 clusters matched exactly, in counts
and index order, and lights behind the camera or outside the frustum were
assigned to no cluster.

## Credits

* [Vite](https://vitejs.dev/)
* [loaders.gl](https://loaders.gl/)
* [dat.GUI](https://github.com/dataarts/dat.gui)
* [stats.js](https://github.com/mrdoob/stats.js)
* [wgpu-matrix](https://github.com/greggman/wgpu-matrix)

The Sponza model is the one shipped with the assignment. The Perlin noise used
by the provided light movement shader is by Stefan Gustavson and Munrocket
(MIT).
