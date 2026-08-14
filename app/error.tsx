"use client";

import { useEffect } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Shown when a page fails to render — most often because the database is
 * unreachable. The connection helper now throws instead of returning a
 * disconnected client, so this is where that surfaces.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] page failed to render", error);
  }, [error]);

  return (
    <PageShell width="sm">
      <Card className="p-6 text-center">
        <CardHeader
          as="h1"
          align="center"
          eyebrow="À la carte restaurant"
          title="Something went wrong"
          description="We could not load this page just now. Please try again in a moment, or contact guest services if it keeps happening."
        />

        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-ink-subtle">Reference: {error.digest}</p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="flex-1" onClick={reset}>
            Try again
          </Button>
          <ButtonLink href="/booking" size="lg" className="flex-1">
            Start over
          </ButtonLink>
        </div>
      </Card>
    </PageShell>
  );
}
