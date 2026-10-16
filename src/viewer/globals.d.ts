interface HandoffSpacingApi {
  create(nodes: unknown[], pages?: unknown[]): {
    measure(id: string): unknown
    frame(id: string): unknown
    layout(id: string): unknown
    between(id: string, targetId: string): unknown
  }
  inverse(transform: number[][]): number[][] | null
  point(transform: number[][], point: { x: number; y: number }): { x: number; y: number }
  rect(node: unknown, inverse: number[][]): unknown
}

interface Window {
  HANDOFF: {
    title?: string
    nodes: any[]
    assets: any[]
    pages: any[]
    previews: any[]
    navigation?: string[]
  }
  HandoffSpacing: HandoffSpacingApi
}
