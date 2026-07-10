export default function ActionButtons() {
  return (
    <div className="space-y-2">
      <button className="w-full bg-ink-100 text-white text-sm font-semibold py-2.5 rounded hover:opacity-90 flex items-center justify-center gap-2">
        <span>📨</span> Request Missing Doc
      </button>
      <button className="w-full bg-bone-0 border border-bone-300 text-ink-100 text-sm font-medium py-2 rounded hover:bg-bone-200 flex items-center justify-center gap-2">
        <span>✓</span> Mark as Reviewed
      </button>
      <button className="w-full bg-bone-0 border border-bone-300 text-ink-100 text-sm font-medium py-2 rounded hover:bg-bone-200 flex items-center justify-center gap-2">
        <span>＋</span> Add Manual Entry
      </button>
    </div>
  );
}
