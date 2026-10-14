import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export type AutocompleteOption = { value: string; label: string; detail?: string };

type MarketAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  options: AutocompleteOption[];
  label: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  spellCheck?: boolean;
  leadingSearch?: boolean;
  disabled?: boolean;
  testId?: string;
};

export function MarketAutocomplete({
  value, onChange, options, label, placeholder, className = '', inputClassName = '',
  autoCapitalize = 'none', spellCheck = false, leadingSearch = false, disabled = false, testId,
}: MarketAutocompleteProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const term = value.trim().toLocaleLowerCase();
  const matches = term ? options
    .map((option, sourceIndex) => {
      const label = option.label.toLocaleLowerCase();
      const optionValue = option.value.toLocaleLowerCase();
      const detail = option.detail?.toLocaleLowerCase() ?? '';
      const detailHead = detail.split(/[ ·,/]+/)[0];
      const rank = optionValue === term ? 0
        : detailHead === term ? 1
          : label.startsWith(term) ? 2
            : optionValue.startsWith(term) ? 3
              : detail.startsWith(term) ? 4
                : label.includes(term) || optionValue.includes(term) || detail.includes(term) ? 5 : 99;
      return { option, sourceIndex, rank };
    })
    .filter((item) => item.rank < 99)
    .sort((left, right) => left.rank - right.rank || left.sourceIndex - right.sourceIndex)
    .slice(0, 8)
    .map((item) => item.option) : [];

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  useEffect(() => setActiveIndex(-1), [value]);

  const choose = (option: AutocompleteOption) => {
    onChange(option.value);
    setOpen(false);
    setActiveIndex(-1);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && matches.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => index < matches.length - 1 ? index + 1 : 0);
    } else if (event.key === 'ArrowUp' && matches.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => index > 0 ? index - 1 : matches.length - 1);
    } else if (event.key === 'Enter' && open && activeIndex >= 0 && matches[activeIndex]) {
      event.preventDefault();
      choose(matches[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className={`market-autocomplete ${className}`} ref={rootRef}>
      {leadingSearch && <Search size={15} aria-hidden="true" />}
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        value={value}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        disabled={disabled}
        className={inputClassName}
        data-testid={testId}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => { if (value.trim()) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul id={`${id}-listbox`} role="listbox" className="market-autocomplete-list">
          {matches.map((option, index) => (
            <li
              key={`${option.value}-${option.label}`}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : ''}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.detail && <small>{option.detail}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
