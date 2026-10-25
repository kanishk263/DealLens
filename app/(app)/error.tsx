"use client";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState description="The page could not be loaded. No changes were made." action={<Button variant="secondary" onClick={reset}>Try again</Button>} />;
}
