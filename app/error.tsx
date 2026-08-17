"use client";

import { useEffect } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";

/**
 * Shown when a page fails to render — most often because the database is
 * unreachable. The connection helper now throws instead of returning a
 * disconnected client, so this is where that surfaces.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    console.error("[app] page failed to render", error);
  }, [error]);

  return (
    <PageShell width="sm">
      <Card className="p-6 text-center">
        <CardHeader
          as="h1"
          align="center"
          eyebrow="Vista Del Mar"
          title={t.appError.title}
          description={t.appError.description}
        />

        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-ink-subtle">
            {t.appError.reference}: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="flex-1" onClick={reset}>
            {t.appError.tryAgain}
          </Button>
          <ButtonLink href="/booking" size="lg" className="flex-1">
            {t.appError.startOver}
          </ButtonLink>
        </div>
      </Card>
    </PageShell>
  );
}
