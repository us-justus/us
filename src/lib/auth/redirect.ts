import type { OnboardingStep } from "@/lib/onboarding/state";
import { stepPath } from "@/lib/onboarding/state";

/**
 * Single reusable helper for deciding where an authenticated user should go.
 *
 * - complete  → /home (waiting home)
 * - otherwise → the appropriate /onboarding/* step
 *
 * Never routes between /login and /onboarding in a loop: /login sends
 * authenticated users here exactly once after sign-in, and /onboarding's
 * index already redirects via the same stepPath().
 */
export function destinationForStep(step: OnboardingStep): string {
  return stepPath(step);
}
