import { useId, useRef, type CSSProperties } from 'react';
import { t } from '../i18n/translations';

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Each step while the slider moves. */
  onLive: (value: number) => void;
  /** Once it's let go (pointer, key or focus leaving), if it moved. */
  onCommit: (value: number) => void;
  format?: (value: number) => string;
  /** A double click puts the slider back here. */
  resetTo?: number;
}

/**
 * A labelled slider. The track fills from its resting value — the middle of
 * a -100..100 slider, the start of a 0..100 one — to where it is, so how far
 * it's been pushed, and which way, shows at a glance.
 */
export function RangeField({ label, value, min, max, step = 1, onLive, onCommit, format, resetTo }: RangeFieldProps) {
  const id = useId();
  const moved = useRef(false);
  const end = (input: HTMLInputElement) => {
    if (!moved.current) return;
    moved.current = false;
    onCommit(Number(input.value));
  };
  const origin = resetTo ?? min;
  const pct = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  const from = Math.min(pct(origin), pct(value));
  const to = Math.max(pct(origin), pct(value));
  return (
    <div className="range-field">
      <div className="range-field-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        title={resetTo !== undefined ? t('range.resetHint') : undefined}
        style={{ '--range-from': `${from}%`, '--range-to': `${to}%` } as CSSProperties}
        onChange={(e) => {
          moved.current = true;
          onLive(Number(e.target.value));
        }}
        onPointerUp={(e) => end(e.currentTarget)}
        onKeyUp={(e) => end(e.currentTarget)}
        onBlur={(e) => end(e.currentTarget)}
        onDoubleClick={() => {
          if (resetTo === undefined || value === resetTo) return;
          moved.current = false;
          onLive(resetTo);
          onCommit(resetTo);
        }}
      />
    </div>
  );
}

/** "+12", "−8", "0": a slider that goes both ways. */
export const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
