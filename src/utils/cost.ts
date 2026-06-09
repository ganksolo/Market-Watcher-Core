export interface CostEstimate {
  postReads: number;
  userReads: number;
  totalUsd: number;
}

export function estimateCost(
  postReads: number,
  userReads: number,
  postCostPerUnit: number,
  userCostPerUnit: number
): CostEstimate {
  return {
    postReads,
    userReads,
    totalUsd: postReads * postCostPerUnit + userReads * userCostPerUnit,
  };
}
