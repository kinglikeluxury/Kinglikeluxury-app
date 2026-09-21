---
name: RunPod remote image builds
description: The KAY RunPod CUDA image must be built remotely because local Docker layer extraction hits the Replit Docker quota.
---

Use the repository's GitHub Actions image workflow for the KAY RunPod CUDA image. A local Docker or BuildKit build can download the base image but fails while extracting a multi-gigabyte CUDA layer with `disk quota exceeded`, even when the Docker filesystem reports free space.

**Why:** The Replit Docker daemon has an effective layer-extraction quota that is smaller than the pinned RunPod PyTorch/CUDA base image. Repeating local builds wastes time and leaves no usable image.

**How to apply:** Run the local unit/static checks first, push the source commit, let the remote workflow build and push the SHA tag, then verify the GHCR manifest before changing the RunPod template.