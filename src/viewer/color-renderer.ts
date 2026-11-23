import { invertLightness } from "./lightness";

const vertexShader = `#version 300 es
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentShader = `#version 300 es
precision highp float;
uniform sampler2D page;
out vec4 color;

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  pixel.y = textureSize(page, 0).y - 1 - pixel.y;
  vec4 source = texelFetch(page, pixel, 0);
  float low = min(source.r, min(source.g, source.b));
  float high = max(source.r, max(source.g, source.b));
  color = vec4(source.rgb + (1.0 - high - low), source.a);
}`;

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

class WebGLColorRenderer {
  static create(): WebGLColorRenderer | null {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!gl) return null;

    const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader);
    const program = gl.createProgram();
    const texture = gl.createTexture();
    if (!vertex || !fragment || !program || !texture) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return null;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return null;
    }

    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "page"), 0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    return new WebGLColorRenderer(canvas, gl);
  }

  private readonly textureLimit: number;
  private readonly viewportLimit: Int32Array;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
  ) {
    this.textureLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.viewportLimit = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  }

  draw(source: HTMLCanvasElement, destination: CanvasRenderingContext2D): boolean {
    const { canvas, gl, textureLimit, viewportLimit } = this;
    const { width, height } = source;
    if (gl.isContextLost() || width > Math.min(textureLimit, viewportLimit[0])
        || height > Math.min(textureLimit, viewportLimit[1])) return false;

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) return false;
    gl.viewport(0, 0, width, height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.getError() !== gl.NO_ERROR) return false;

    destination.drawImage(canvas, 0, 0);
    return true;
  }

  releaseBuffer() {
    this.canvas.width = this.canvas.height = 1;
    const { gl } = this;
    if (!gl.isContextLost()) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }
}

export class ColorRenderer {
  private webgl: WebGLColorRenderer | null | undefined;

  draw(source: HTMLCanvasElement, output: HTMLCanvasElement): boolean {
    if (this.webgl === undefined) this.webgl = WebGLColorRenderer.create();
    const { width, height } = source;
    output.width = width;
    output.height = height;
    const destination = output.getContext("2d", { willReadFrequently: !this.webgl });
    if (!destination || !width || !height) return false;
    if (this.webgl?.draw(source, destination)) return true;

    destination.drawImage(source, 0, 0);
    const data = destination.getImageData(0, 0, width, height);
    invertLightness(data.data);
    destination.putImageData(data, 0, 0);
    return true;
  }

  releaseBuffer() {
    this.webgl?.releaseBuffer();
  }
}
