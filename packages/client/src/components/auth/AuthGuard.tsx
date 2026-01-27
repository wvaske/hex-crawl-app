import { useState } from "react";
import { authClient } from "../../lib/auth-client";
import { LoginPage } from "./LoginPage";
import { SignupPage } from "./SignupPage";

/**
 * Session-gated wrapper that shows login/signup when unauthenticated
 * and renders children (the actual app) when authenticated.
 *
 * Uses Better Auth's useSession() hook for reactive session state.
 * Session persists across browser refreshes via cookie.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const [showSignup, setShowSignup] = useState(false);

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    if (showSignup) {
      return <SignupPage onSwitchToLogin={() => setShowSignup(false)} />;
    }
    return <LoginPage onSwitchToSignup={() => setShowSignup(true)} />;
  }

  return <>{children}</>;
}
