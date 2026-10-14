// The slice of the WebGPU API the GPU engine uses. TypeScript's DOM library does not declare WebGPU and
// the site takes no @webgpu/types dependency, so these local types stand in for it. They carry a `Gpu`
// prefix so they never collide with the DOM's own `GPU*` declarations when those arrive.

export interface GpuApi {
  requestAdapter(options?: { powerPreference?: "low-power" | "high-performance" }): Promise<GpuAdapter | null>;
}

export interface GpuAdapterInfo {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
}

export interface GpuAdapter {
  readonly info?: GpuAdapterInfo;
  /// Browsers before `info` existed (Chrome < 127).
  requestAdapterInfo?(): Promise<GpuAdapterInfo>;
  requestDevice(descriptor?: { label?: string }): Promise<GpuDevice>;
}

export interface GpuDeviceLostInfo {
  readonly reason: "unknown" | "destroyed" | undefined;
  readonly message: string;
}

export interface GpuCompilationMessage {
  readonly type: "error" | "warning" | "info";
  readonly message: string;
  readonly lineNum: number;
  readonly linePos: number;
}

export interface GpuShaderModule {
  getCompilationInfo(): Promise<{ readonly messages: readonly GpuCompilationMessage[] }>;
}

export interface GpuBindGroupLayout {
  readonly label: string;
}

export interface GpuBindGroup {
  readonly label: string;
}

export interface GpuCommandBuffer {
  readonly label: string;
}

export interface GpuComputePipeline {
  getBindGroupLayout(index: number): GpuBindGroupLayout;
}

export interface GpuBuffer {
  readonly size: number;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface GpuComputePassEncoder {
  setPipeline(pipeline: GpuComputePipeline): void;
  setBindGroup(index: number, group: GpuBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface GpuCommandEncoder {
  beginComputePass(descriptor?: { label?: string }): GpuComputePassEncoder;
  clearBuffer(buffer: GpuBuffer, offset?: number, size?: number): void;
  copyBufferToBuffer(source: GpuBuffer, sourceOffset: number, destination: GpuBuffer, destinationOffset: number, size: number): void;
  finish(): GpuCommandBuffer;
}

export interface GpuQueue {
  submit(buffers: GpuCommandBuffer[]): void;
  writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView | ArrayBuffer): void;
  onSubmittedWorkDone(): Promise<void>;
}

export interface GpuDevice {
  readonly queue: GpuQueue;
  readonly lost: Promise<GpuDeviceLostInfo>;
  createBuffer(descriptor: { label?: string; size: number; usage: number; mappedAtCreation?: boolean }): GpuBuffer;
  createShaderModule(descriptor: { label?: string; code: string }): GpuShaderModule;
  createComputePipelineAsync(descriptor: { label?: string; layout: "auto"; compute: { module: GpuShaderModule; entryPoint: string } }): Promise<GpuComputePipeline>;
  createBindGroup(descriptor: { label?: string; layout: GpuBindGroupLayout; entries: { binding: number; resource: { buffer: GpuBuffer } }[] }): GpuBindGroup;
  createCommandEncoder(descriptor?: { label?: string }): GpuCommandEncoder;
  pushErrorScope(filter: "validation" | "out-of-memory" | "internal"): void;
  popErrorScope(): Promise<{ readonly message: string } | null>;
  destroy(): void;
}

/// GPUBufferUsage and GPUMapMode, by value (the globals are not typed either).
export const BufferUsage = { MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080 } as const;
export const MapMode = { READ: 0x0001 } as const;
