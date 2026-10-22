import { useId, useRef, type CSSProperties } from 'react';
import { RotateCcw } from 'lucide-react';
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
  /** The value last sent out — what letting go commits. */
  const last = useRef(value);
  /**
   * A touch on the slider. A swipe that only meant to scroll the panel still
   * moves the thumb the moment it lands, so where it lands is held back
   * (`held`) until the finger slides along the track (`sliding`) or lifts:
   * a scroll then changes nothing, not even the undo history.
   */
  const touch = useRef<{ x: number; start: number; held: number | null; sliding: boolean } | null>(null);
  const live = (v: number) => {
    moved.current = true;
    last.current = v;
    onLive(v);
  };
  const end = () => {
    if (!moved.current) return;
    moved.current = false;
    onCommit(last.current);
  };
  const origin = resetTo ?? min;
  const pct = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  const from = Math.min(pct(origin), pct(value));
  const to = Math.max(pct(origin), pct(value));
  return (
    <div className="range-field">
      <div className="range-field-head">
        <label htmlFor={id}>{label}</label>
        <span className="range-field-value">
          {resetTo !== undefined && value !== resetTo && (
            <button
              type="button"
              className="range-field-reset"
              aria-label={t('range.reset', { label })}
              title={t('range.reset', { label })}
              onClick={() => {
                moved.current = false;
                onLive(resetTo);
                onCommit(resetTo);
              }}
            >
              <RotateCcw size={12} strokeWidth={2.75} />
            </button>
          )}
          <output htmlFor={id}>{format ? format(value) : value}</output>
        </span>
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
          const v = Number(e.target.value);
          const held = touch.current;
          if (held && !held.sliding) held.held = v;
          else live(v);
        }}
        onPointerDown={(e) => {
          touch.current = e.pointerType === 'touch' ? { x: e.clientX, start: value, held: null, sliding: false } : null;
        }}
        onPointerMove={(e) => {
          const held = touch.current;
          if (!held || held.sliding || Math.abs(e.clientX - held.x) < 6) return;
          held.sliding = true;
          if (held.held !== null) live(held.held);
        }}
        onPointerUp={() => {
          const held = touch.current;
          touch.current = null;
          // A tap: the thumb goes where it was tapped.
          if (held && !held.sliding && held.held !== null) live(held.held);
          end();
        }}
        onPointerCancel={() => {
          const held = touch.current;
          touch.current = null;
          // The swipe turned into a scroll of the panel. Held back, nothing
          // happened; already sliding, the value it slid to wasn't a choice,
          // so it's put back.
          if (!held?.sliding || !moved.current) return;
          moved.current = false;
          onLive(held.start);
          onCommit(held.start);
        }}
        onKeyUp={end}
        onBlur={end}
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
