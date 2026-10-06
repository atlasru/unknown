import type { GraphNode, Edge } from './types';
export function createLayout(nodes: GraphNode[], edges: Edge[]): { step: (count?: number) => Float32Array; positions: Float32Array; pin: (id: string, x: number, y: number) => void; unpin: (id: string) => void; iteration: number };
