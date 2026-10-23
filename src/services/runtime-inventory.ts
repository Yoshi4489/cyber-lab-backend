/** Complete, read-only snapshot of the single node's backend-managed allocations. */
export type ManagedRuntimeAllocation = {
  instanceId: string;
  challengeId: string | null;
  containerId: string | null;
  networkId: string | null;
  routePresent: boolean;
};

export type ManagedRuntimeInventory = {
  allocations: readonly ManagedRuntimeAllocation[];
  /** All Engine IDs, including unmanaged resources, prove that persisted IDs are absent. */
  containerIds: readonly string[];
  networkIds: readonly string[];
};
