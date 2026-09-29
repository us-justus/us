export default function Layout({ children }: { children: React.ReactNode }) {
  // Intentionally no session/onboarding lookup here: every step page and the
  // onboarding index already resolve state via getOnboardingState(). Fetching
  // it in the layout as well would double auth + DB round-trips on every
  // /onboarding/* navigation.
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-10 sm:py-14">
        {children}
      </div>
    </div>
  );
}
