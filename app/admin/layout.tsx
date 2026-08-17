import { I18nProvider } from "@/components/i18n-provider";
import { getDictionary, DEFAULT_LANGUAGE } from "@/lib/i18n";

/**
 * Staff screens are English, whatever the guest interface is set to.
 *
 * The root layout resolves the guest's language from a cookie, and that cookie
 * belongs to the browser, not to the person: reception's machine had been used
 * to check the booking flow in Russian, and the shared controls in the admin
 * header — the theme buttons and their tooltips — came back in Russian on the
 * dashboard. One team, one language, and the audit log is English too.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <I18nProvider language={DEFAULT_LANGUAGE} dictionary={getDictionary(DEFAULT_LANGUAGE)}>
      {children}
    </I18nProvider>
  );
}
