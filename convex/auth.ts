import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import Resend from "@auth/core/providers/resend";

const emailProvider = process.env.RESEND_API_KEY
  ? Resend({
      apiKey: process.env.RESEND_API_KEY,
      from:
        process.env.AUTH_EMAIL_FROM ??
        "Venue Wrangler <noreply@venuewrangler.com>",
      maxAge: 15 * 60,
    })
  : undefined;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      reset: emailProvider,
      validatePasswordRequirements(password) {
        if (password.length < 10)
          throw new Error("Password must be at least 10 characters.");
        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
          throw new Error(
            "Password must include at least one letter and one number.",
          );
        }
      },
    }),
  ],
});
