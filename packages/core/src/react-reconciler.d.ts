// Minimal types for react-reconciler 0.34. The package has no types of its
// own, and @types/react-reconciler describes an older API.
declare module 'react-reconciler' {
  const Reconciler: (config: Record<string, unknown>) => any;
  export default Reconciler;
}
declare module 'react-reconciler/constants.js' {
  export const ConcurrentRoot: number;
  export const DefaultEventPriority: number;
  export const DiscreteEventPriority: number;
  export const NoEventPriority: number;
}
