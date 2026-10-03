export default function Loading() {
  return (
    <div className="absolute inset-0 mx-auto flex w-full max-w-[560px] flex-col" aria-label="loading conversation">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3 sm:px-8">
        <div aria-hidden className="h-11 w-11 shrink-0 rounded-full border border-line bg-paper-2" />
        <div aria-hidden className="min-w-0 flex-1">
          <div className="h-4 w-28 rounded-full bg-line" />
          <div className="mt-2 h-3 w-40 rounded-full bg-line" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-6 py-6 sm:px-8">
        <div aria-hidden className="ml-auto h-11 w-2/3 rounded-[20px] bg-line" />
        <div aria-hidden className="mt-4 h-11 w-1/2 rounded-[20px] border border-line bg-paper-2" />
        <div aria-hidden className="ml-auto mt-4 h-8 w-1/3 rounded-[20px] bg-line" />
      </div>
      <div className="border-t border-line px-6 pt-3 sm:px-8" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        <div aria-hidden className="h-[52px] rounded-2xl border border-line bg-paper-2" />
      </div>
    </div>
  );
}
