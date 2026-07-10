export default function ComingSoon({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="mx-auto w-14 h-14 rounded-full bg-accent-soft text-accent grid place-items-center text-2xl font-bold mb-4">
          ⏳
        </div>
        <h1 className="text-xl font-bold text-ink-100">{title}</h1>
        <p className="text-sm text-ink-300 mt-2">
          {subtitle ?? "This screen is part of the MedLynq vision. Coming in a later sprint."}
        </p>
        <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mt-4">Coming soon</div>
      </div>
    </div>
  );
}
