import AppShell from "@/components/AppShell";
import UploadDropzone from "@/components/UploadDropzone";
import { usedBytes } from "@/lib/db";
import { pricingFor } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  return (
    <AppShell>
      <main className="flex-1">
        <UploadDropzone
          usedBytes={usedBytes()}
          pricing={pricingFor(process.env.AWS_REGION).pricing}
        />
      </main>
    </AppShell>
  );
}
