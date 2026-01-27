import { useState } from "react";
import { authClient } from "../../lib/auth-client";

interface LoginPageProps {
  onSwitchToSignup: () => void;
}

export function LoginPage({ onSwitchToSignup }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    try {
      const { error } = await authClient.signIn.email({
        email,
        password,
      });

      if (error) {
        // Map error to inline field errors where possible
        const msg = error.message ?? "Login failed";
        const lower = msg.toLowerCase();

        if (lower.includes("user") || lower.includes("email") || lower.includes("not found") || lower.includes("account")) {
          setErrors({ email: msg });
        } else if (lower.includes("password") || lower.includes("credentials") || lower.includes("invalid")) {
          setErrors({ password: msg });
        } else {
          setErrors({ general: msg });
        }
      }
      // On success, Better Auth sets the session cookie automatically.
      // The AuthGuard's useSession() will reactively update.
    } catch {
      setErrors({ general: "An unexpected error occurred. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="bg-gray-800 rounded-lg shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-100 mb-6 text-center">
          Sign In
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* General error */}
          {errors.general && (
            <div className="text-red-400 text-sm bg-red-900/30 rounded px-3 py-2">
              {errors.general}
            </div>
          )}

          {/* Email */}
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-300 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full px-3 py-2 rounded bg-gray-700 text-gray-100 border ${
                errors.email ? "border-red-500" : "border-gray-600"
              } focus:border-blue-500 focus:outline-none transition-colors`}
              placeholder="you@example.com"
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-400">{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-300 mb-1">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full px-3 py-2 rounded bg-gray-700 text-gray-100 border ${
                errors.password ? "border-red-500" : "border-gray-600"
              } focus:border-blue-500 focus:outline-none transition-colors`}
              placeholder="Enter your password"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-400">{errors.password}</p>
            )}
          </div>

          {/* Forgot password link */}
          <div className="text-right">
            <button
              type="button"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              onClick={() => {
                // Placeholder for Better Auth's password reset flow.
                // Will be wired to authClient.forgetPassword when fully implemented.
                alert("Password reset is not yet configured. Contact the administrator.");
              }}
            >
              Forgot password?
            </button>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2 transition-colors"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {/* Switch to signup */}
        <p className="mt-6 text-center text-sm text-gray-400">
          Don't have an account?{" "}
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
          >
            Sign up
          </button>
        </p>
      </div>
    </div>
  );
}
