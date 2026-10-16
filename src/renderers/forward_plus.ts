import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import { NaiveRenderer } from './naive';

// Forward+ renderer
// Use the NaiveRenderer as a base and override the fragment shader
export class ForwardPlusRenderer extends NaiveRenderer {
    constructor(stage: Stage) {
        super(stage, {
            fragmentShaderSrc: shaders.forwardPlusFragSrc,
            label: "forward+",
            runClustering: true
        });
    }
}
