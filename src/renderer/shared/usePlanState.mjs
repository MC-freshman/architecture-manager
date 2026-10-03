import { useState } from 'react';
export function usePlanState() {
  const [planPreview,setPlanPreview] = useState(null);
  const [planPayload,setPlanPayload] = useState(null);
  return { planPreview,setPlanPreview,planPayload,setPlanPayload };
}
