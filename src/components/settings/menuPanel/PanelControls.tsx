/**
 * Shared controls for the menu panel.
 *
 * Small, unstyled-by-default pieces used across several tabs; each one exists because the
 * same markup was otherwise repeated per field, which is how two switches end up behaving
 * differently.
 */

import { ReactNode } from 'react';
import { Check } from 'lucide-react';

export function PanelField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs sm:text-sm font-bold text-stone-800 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-stone-400 mt-1 leading-relaxed">{hint}</span>}
    </label>
  );
}

const INPUT_CLASS =
  'w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 text-sm font-semibold text-stone-900 ' +
  'focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-all text-right shadow-sm';

export function PanelInput({
  value,
  onChange,
  placeholder,
  maxLength,
  dir,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  dir?: 'rtl' | 'ltr';
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      dir={dir}
      className={INPUT_CLASS}
    />
  );
}

/** A labelled on/off switch. Reads as a checkbox to a screen reader, not as a styled div. */
export function PanelToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3 cursor-pointer hover:border-stone-300 transition-colors">
      <span className="flex-1">
        <span className="block text-xs sm:text-sm font-bold text-stone-800">{label}</span>
        {hint && <span className="block text-[11px] text-stone-400 mt-0.5 leading-relaxed">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`shrink-0 mt-0.5 w-11 h-6 rounded-full p-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500/40 ${
          checked ? 'bg-amber-500' : 'bg-stone-300'
        }`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
            checked ? '-translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </label>
  );
}

/** A row of mutually exclusive choices. */
export function PanelChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="block text-xs sm:text-sm font-bold text-stone-800 mb-1.5">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map(option => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              aria-pressed={selected}
              className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                selected
                  ? 'bg-stone-900 text-white border-stone-900 shadow-sm'
                  : 'bg-white text-stone-700 border-gray-200 hover:border-stone-300'
              }`}
            >
              {selected && <Check size={13} />}
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PanelSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-stone-50/70 border border-stone-200/60 rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="text-xs sm:text-sm font-bold text-stone-800">{title}</h3>
        {hint && <p className="text-[11px] text-stone-400 mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
