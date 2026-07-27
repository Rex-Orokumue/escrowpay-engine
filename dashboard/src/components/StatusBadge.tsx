const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-dim text-green',
  completed: 'bg-green-dim text-green',
  released: 'bg-green-dim text-green',
  funded: 'bg-orange-dim text-orange',
  created: 'bg-blue-dim text-blue',
  refunded: 'bg-blue-dim text-blue',
  disputed: 'bg-red-dim text-red',
  suspended: 'bg-red-dim text-red',
  failed: 'bg-red-dim text-red'
};

export default function StatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status] ?? 'bg-surface-2 text-muted';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${colorClass}`}>
      {status}
    </span>
  );
}
