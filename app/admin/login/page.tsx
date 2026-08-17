"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // A 503 means the server has no admin secrets configured; saying
        // "invalid credentials" would send staff chasing the wrong problem.
        setError(response.status === 503 ? data.error : "Invalid username or password.");
        setSubmitting(false);
        return;
      }

      const next = searchParams.get("next");
      router.push(next?.startsWith("/admin") ? next : "/admin");
      router.refresh();
    } catch {
      setError("We could not reach the server. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeader as="h1" align="center" eyebrow="Admin access" title="Hotel staff login" />

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field label="Username">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          )}
        </Field>

        <Field label="Password">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Button type="submit" size="lg" className="w-full" loading={submitting} loadingLabel="Signing in…">
          Sign in
        </Button>
      </form>
    </Card>
  );
}

export default function AdminLoginPage() {
  return (
    <PageShell width="sm" showLanguage={false}>
      <Suspense fallback={null}>
        <AdminLoginForm />
      </Suspense>
    </PageShell>
  );
}
