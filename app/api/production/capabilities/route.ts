import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { LONG_FORM_LEVELS, STUDIO_CAPABILITIES } from "@/lib/studio-capabilities";
import { MEDIA_WORKER_CONTRACT_VERSION, REQUIRED_MEDIA_WORKER_CAPABILITIES } from "@/lib/media-worker-contract";
export async function GET() {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  const runtime = process.env as unknown as { NUMU_MEDIA_WORKER_URL?: string; NUMU_MEDIA_WORKER_SECRET?: string };
  return Response.json({
    capabilities: STUDIO_CAPABILITIES,
    hierarchy: LONG_FORM_LEVELS,
    policy: {
      routePerShot: true,
      automaticRetries: false,
      explicitSpendApproval: true,
      browserAssemblyIsPreview: true,
      professionalConformRequiresWorker: true,
      perfumeRetestBlockedUntilReady: true,
    },
    mediaWorker: {
      configured: Boolean(runtime.NUMU_MEDIA_WORKER_URL && runtime.NUMU_MEDIA_WORKER_SECRET),
      contractVersion: MEDIA_WORKER_CONTRACT_VERSION,
      requiredCapabilities: REQUIRED_MEDIA_WORKER_CAPABILITIES,
      secretConfigured: Boolean(runtime.NUMU_MEDIA_WORKER_SECRET),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
