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

[img/demo.mp4](img/demo.mp4) is 45 seconds and covers all four modes: naive, Forward+, Clustered
Deferred and the cluster debug view, ending with Forward+ and Clustered Deferred running the full
5000 lights.

## What is implemented

The scene is the Sponza atrium with up to 5000 moving point lights. The GUI
switches between four renderers:

| Mode | |
|---|---|
| **Naive** | Every fragment loops over every light in the scene. |
| **Forward+** | 16 x 16 screen tiles x 24 exponentially spaced depth slices (6144 clusters); each fragment walks only the lights of its own cluster. |
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

Frame times are medians of `requestAnimationFrame` intervals, measured in
headless Chrome 154 at a 2560x1600 render target with the light animation
pinned to a fixed moment so that every mode shades the identical scene. The
browser presents at 165 Hz, so every value is a multiple of 6.06 ms: a reported
6.1 ms means "6.06 ms or less, not resolvable".

![](img/perf_frame_time.png)

| Frame time (ms) | 100 | 500 | 1000 | 2000 | 5000 |
|---|---|---|---|---|---|
| Naive | 30.3 | 127.2 | 242.3 | 472.5 | 1181.5 |
| Forward+ | 6.1 | 12.1 | 36.3 | 36.4 | 42.3 |
| Clustered Deferred | 6.1 | 6.1 | 18.1 | 18.2 | 18.2 |

![](img/perf_forward_vs_deferred.png)

* Naive scales linearly with the light count, from 30 ms at 100 lights to
  1182 ms at 5000.
* Forward+ and Clustered Deferred are flat from 1000 to 5000 lights: Forward+
  moves from 36.3 to 42.3 ms while the light count quintuples.
* Clustered Deferred is 2.0-2.3x faster than Forward+ over that range, and both
  cluster lists saturate at 186 of the 6144 clusters hitting the 512 lights per
  cluster cap.

### G-buffer optimisation

The G-buffer was cut from three targets (albedo `rgba8unorm`, normal
`rgba16float`, position `rgba32float`, 28 bytes per pixel) to one colour output
plus one `u32` (8 bytes per pixel), by storing the normal octahedrally packed
and reconstructing the position from depth, and the fullscreen fragment pass
was replaced by the compute pass.

| Clustered Deferred | 500 | 1000 | 2000 | 5000 |
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
| naive vs Forward+ | 0 differing pixels |
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
