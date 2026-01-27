import { useState } from "react";
import { authClient } from "../../lib/auth-client";

interface SignupPageProps {
  onSwitchToLogin: () => void;
}

export function SignupPage({ onSwitchToLogin }: SignupPageProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    general?: string;
  }>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Client-side validation
    if (password.length < 8) {
      setErrors({ password: "Password must be at least 8 characters" });
      return;
    }

    setLoading(true);

    try {
      const { error } = await authClient.signUp.email({
        name,
        email,
        password,
      });

      if (error) {
        // Map error to inline field errors where possible
        const msg = error.message ?? "Signup failed";
        const lower = msg.toLowerCase();

        if (lower.includes("email") || lower.includes("already") || lower.includes("exists") || lower.includes("duplicate")) {
          setErrors({ email: msg });
        } else if (lower.includes("password")) {
          setErrors({ password: msg });
        } else if (lower.includes("name")) {
          setErrors({ name: msg });
        } else {
          setErrors({ general: msg });
        }
      }
      // On success, Better Auth's autoSignIn creates a session automatically.
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
          Create Account
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* General error */}
          {errors.general && (
            <div className="text-red-400 text-sm bg-red-900/30 rounded px-3 py-2">
              {errors.general}
            </div>
          )}

          {/* Name */}
          <div>
            <label htmlFor="signup-name" className="block text-sm font-medium text-gray-300 mb-1">
              Name
            </label>
            <input
              id="signup-name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full px-3 py-2 rounded bg-gray-700 text-gray-100 border ${
                errors.name ? "border-red-500" : "border-gray-600"
              } focus:border-blue-500 focus:outline-none transition-colors`}
              placeholder="Your name"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-400">{errors.name}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="signup-email" className="block text-sm font-medium text-gray-300 mb-1">
              Email
            </label>
            <input
              id="signup-email"
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
            <label htmlFor="signup-password" className="block text-sm font-medium text-gray-300 mb-1">
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full px-3 py-2 rounded bg-gray-700 text-gray-100 border ${
                errors.password ? "border-red-500" : "border-gray-600"
              } focus:border-blue-500 focus:outline-none transition-colors`}
              placeholder="At least 8 characters"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-400">{errors.password}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2 transition-colors"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        {/* Switch to login */}
        <p className="mt-6 text-center text-sm text-gray-400">
          Already have an account?{" "}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
