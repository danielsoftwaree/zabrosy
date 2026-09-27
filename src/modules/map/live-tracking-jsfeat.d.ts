declare module 'jsfeat' {
  type Point = { x: number; y: number; score?: number }
  type Matrix = { cols: number; rows: number; data: Uint8Array | Float32Array }
  type Pyramid = { levels: number; data: Matrix[]; allocate(width: number, height: number, type: number): void; build(input: Matrix, skipFirstLevel?: boolean): void }
  type Model = { run(from: Point[], to: Point[], matrix: Matrix, count: number): number }
  const jsfeat: {
    U8C1_t: number
    F32C1_t: number
    matrix_t: new (cols: number, rows: number, type: number) => Matrix
    pyramid_t: new (levels: number) => Pyramid
    keypoint_t: new (x?: number, y?: number, score?: number) => Point
    ransac_params_t: new (size: number, threshold: number, outlierRatio: number, probability: number) => object
    yape06: { detect(image: Matrix, points: Point[], border?: number): number }
    optical_flow_lk: { track(previous: Pyramid, current: Pyramid, from: Float32Array, to: Float32Array, count: number, window: number, iterations: number, status: Uint8Array, epsilon: number, minEigen: number): void }
    motion_model: { homography2d: new () => Model }
    motion_estimator: { ransac(params: object, model: Model, from: Point[], to: Point[], count: number, matrix: Matrix, mask: Matrix, iterations: number): boolean }
  }
  export = jsfeat
}
