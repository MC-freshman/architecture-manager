# Unified implementation baseline

Authorized on 2026-10-03 by the user. Ordered plan: E:/ai/versions/架构管理台全面修复模块化接入与提速方案P表-20261003.md, P1 through P18. Progress: E:/ai/versions/架构管理台统一实施进度-20261003.md.

Source rollback anchor: 9d3e5b42a6b5a2335e583d94a034c36a7c482d4b (0.4.1). Branch: codex/manager-unified-20261003. Deliverables: 0.4.2 at P8; 0.5.0 at P18. No existing release bytes will be overwritten.

Keep Electron/React, the three repositories, frozen dependency pins, and existing providers. Separate query/plan/execute/verify; share integrity, transaction and owned-task rules. Do not introduce a parallel runtime engine. Development baseline: Node 24.18.0; lock file is authoritative.

Batch candidates: wf-runner 0.12.2 and architecture-ops 1.5.2, using repo-lint 0.6.4 and runtime-contracts 1.5.0. Publishing does not silently adopt versions in platform configuration.

Performance samples: workflow:expert-task@1.1.0 and agent:game-builder@1.10.0, three measurements for old patched CLI and candidate; successful row starts 3 -> 1 and median duration <=80%. Full matrices remain limited to initial onboarding and incompatible engine/contract upgrades.

Audit evidence is platform-local maintenance data with agent/workflow=null. Environments belong to the owning platform runtime (BP-1 route 3). Preserve source documents and old releases. Unexpected non-blocking findings are recorded for later planning, not added to the approved acceptance criteria.
