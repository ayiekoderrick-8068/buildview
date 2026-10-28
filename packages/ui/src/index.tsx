import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

/**
 * Small, framework-light UI kit shared by the studio. Styling uses Tailwind utility classes and the
 * design tokens documented in docs/design-system.md (CSS variables defined by the web app).
 */

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--bv-accent)] text-[#1a1408] hover:bg-[var(--bv-accent-hover)] font-semibold shadow-[0_0_0_1px_rgba(0,0,0,0.2)]',
  secondary:
    'bg-[var(--bv-surface-2)] text-[var(--bv-text)] border border-[var(--bv-border)] hover:bg-[var(--bv-surface-3)]',
  ghost: 'bg-transparent text-[var(--bv-text-dim)] hover:bg-[var(--bv-surface-2)] hover:text-[var(--bv-text)]',
  danger: 'bg-transparent text-[var(--bv-danger)] border border-[var(--bv-danger)]/40 hover:bg-[var(--bv-danger)]/10',
};

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg transition-colors duration-150 select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bv-accent)]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-auto',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={rest.title ?? label}
      aria-pressed={active}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bv-accent)]',
        'disabled:opacity-35 disabled:cursor-not-allowed',
        active
          ? 'bg-[var(--bv-accent)]/15 text-[var(--bv-accent)]'
          : 'text-[var(--bv-text-dim)] hover:bg-[var(--bv-surface-2)] hover:text-[var(--bv-text)]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-[var(--bv-border)] px-4 py-4 last:border-b-0">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--bv-text-faint)]">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Explains why the control is disabled (shown instead of the value hint). */
  disabledReason?: string;
  format?: (v: number) => string;
  testId?: string;
}

export function Slider({ label, value, min, max, step, onChange, disabled, disabledReason, format, testId }: SliderProps) {
  const id = useId();
  return (
    <div className={cx('mb-3 last:mb-0', disabled && 'opacity-50')}>
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs text-[var(--bv-text-dim)]">
          {label}
        </label>
        <span className="font-mono text-xs tabular-nums text-[var(--bv-text)]">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        id={id}
        data-testid={testId}
        type="range"
        className="bv-range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {disabled && disabledReason ? (
        <p className="mt-1 text-[11px] leading-snug text-[var(--bv-text-faint)]">{disabledReason}</p>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-lg bg-[var(--bv-surface-0)] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-md px-2 py-1.5 text-xs transition-colors duration-150',
            'focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            o.value === value
              ? 'bg-[var(--bv-surface-3)] text-[var(--bv-text)] shadow-sm'
              : 'text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Swatch({
  color,
  name,
  selected,
  onClick,
}: {
  color: string;
  name: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={name}
      aria-label={`${name} ${color}`}
      aria-pressed={selected}
      data-color={color}
      onClick={onClick}
      className={cx(
        'group relative h-9 w-full rounded-lg border transition-all duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bv-accent)]',
        selected
          ? 'border-[var(--bv-accent)] ring-2 ring-[var(--bv-accent)]/40 scale-[1.04]'
          : 'border-white/10 hover:scale-105 hover:border-white/30',
      )}
      style={{ background: `linear-gradient(145deg, ${color}, ${color} 55%, color-mix(in srgb, ${color} 80%, black))` }}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-sm text-[var(--bv-text)] focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]"
    >
      <span>{label}</span>
      <span
        className={cx(
          'relative h-5 w-9 rounded-full transition-colors duration-150',
          checked ? 'bg-[var(--bv-accent)]' : 'bg-[var(--bv-surface-3)]',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-150',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon ? <div className="text-[var(--bv-text-faint)]">{icon}</div> : null}
      <p className="text-sm font-medium text-[var(--bv-text)]">{title}</p>
      <p className="max-w-[16rem] text-xs leading-relaxed text-[var(--bv-text-dim)]">{children}</p>
    </div>
  );
}
