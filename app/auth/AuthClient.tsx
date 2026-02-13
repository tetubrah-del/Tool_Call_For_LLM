"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS } from "@/lib/i18n";

export default function AuthClient() {
  const searchParams = useSearchParams();
  const lang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const strings = UI_STRINGS[lang];
  const { data: session, status } = useSession();

  const callbackUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("lang", lang);
    return `/register?${params.toString()}`;
  }, [lang]);

  return (
    <div className="auth">
      <div className="card auth-card">
        <h1>{strings.authTitle}</h1>
        <p className="muted">{strings.authSubtitle}</p>
        <p className="muted">
          サインインを続行することで、<a href={`/terms?lang=${lang}`}>利用規約</a>に同意したものとみなされます。
        </p>
        {status === "loading" && <p className="muted">{strings.loading}</p>}
        {status !== "loading" && !session && (
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl })}
          >
            {strings.continueGoogle}
          </button>
        )}
        {session && (
          <div className="auth-actions">
            <a className="text-link" href={callbackUrl}>
              {strings.continueProfile}
            </a>
            <button className="secondary" type="button" onClick={() => signOut()}>
              {strings.signOut}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
