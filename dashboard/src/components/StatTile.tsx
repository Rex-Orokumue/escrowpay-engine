interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'default' | 'green' | 'orange' | 'red';
}

const TONE_TEXT: Record<NonNullable<StatTileProps['tone']>, string> = {
  default: 'text-text',
  green: 'text-green',
  orange: 'text-orange',
  red: 'text-red'
};

export default function StatTile({ label, value, sublabel, tone = 'default' }: StatTileProps) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">{label}</div>
      <div className={`text-3xl font-semibold ${TONE_TEXT[tone]}`}>{value}</div>
      {sublabel && <div className="text-xs text-muted mt-2">{sublabel}</div>}
    </div>
  );
}
