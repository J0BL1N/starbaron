/**
 * Global jsdom canvas shim (vitest setup).
 *
 * jsdom does not implement HTMLCanvasElement.getContext('2d'), so any UI test
 * that mounts the planet renderers would otherwise flood stderr with one
 * "Not implemented" warning per texture call — hundreds of thousands across
 * the suite — and the renderer's fallback path would crash on missing methods.
 *
 * This shim installs a minimal 2D context covering BOTH consumers:
 *  1. The pure texture builders (planetgen3d/textures.ts canvasFromRGB):
 *     createImageData + putImageData.
 *  2. The jsdom fallback renderer (planetgen3d/render.ts fallbackPlanetCanvas,
 *     used when WebGL is unavailable — always the case in jsdom): fillStyle,
 *     fillRect, beginPath, arc, fill, globalAlpha, font, textAlign, fillText.
 *
 * All drawing methods are no-ops; tests assert structure/attributes, not pixels.
 */

type FakeCtx = Record<string, unknown>

function makeFakeContext(canvas?: HTMLCanvasElement): FakeCtx {
  const noop = () => {}
  return {
    canvas: canvas ?? ({} as HTMLCanvasElement),
    // texture builders
    createImageData(w: number, h: number): ImageData {
      return {
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      } as unknown as ImageData
    },
    putImageData: noop,
    // fallback renderer surface
    fillStyle: '#000',
    strokeStyle: '#000',
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    lineWidth: 1,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 0 }),
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    clip: noop,
    globalCompositeOperation: 'source-over',
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    drawImage: noop,
    getImageData: () => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }),
    setTransform: noop,
    transform: noop,
  }
}

if (typeof document !== 'undefined') {
  const originalCreateElement = document.createElement.bind(document)

  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const el = originalCreateElement(tag, options)
    if (tag === 'canvas') {
      return new Proxy(el, {
        get(target, prop, receiver) {
          if (prop === 'getContext') {
            return (type: string) => {
              // ONLY shim 2d. Leave webgl/webgl2 returning null so
              // isWebGLAvailable() correctly detects no WebGL in jsdom and the
              // renderer uses its fallbackPlanetCanvas path (the tested surface).
              if (type === '2d') return makeFakeContext(target as HTMLCanvasElement)
              return Reflect.get(target, prop, target)?.call(target, type)
            }
          }
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
    return el
  }) as typeof document.createElement
}
