import { Check, ChevronsUpDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "~/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

interface Placement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const GAP = 6;
const MAX_HEIGHT = 288;

/** Eigene Auswahlliste: schwebt über allem, folgt der Tastatur und klappt nach oben, wenn unten kein Platz ist. */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  icon,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Eintrag für den leeren Wert, z. B. „Aus“. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  icon?: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const items: SelectOption[] =
    placeholder !== undefined ? [{ value: "", label: placeholder }, ...options] : options;
  const selected = items.find((o) => o.value === value);
  const [active, setActive] = useState(0);

  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - GAP * 2;
    const above = rect.top - GAP * 2;
    const up = below < Math.min(MAX_HEIGHT, items.length * 44) && above > below;
    setPlacement({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(MAX_HEIGHT, up ? above : below),
      ...(up ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
    });
  };

  const show = () => {
    if (disabled) return;
    setActive(Math.max(0, items.findIndex((o) => o.value === value)));
    place();
    setOpen(true);
  };

  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };

  const pick = (option: SelectOption) => {
    if (option.value !== value) onChange(option.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      close(e.key === "Escape");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : items.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (items[active]) pick(items[active]);
    } else if (e.key.length === 1) {
      const next = items.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      const first = items.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (next >= 0 || first >= 0) setActive(next >= 0 ? next : first);
    }
  };

  const empty = !selected || selected.value === "";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        className={cn(
          "group flex h-10 w-full min-w-0 cursor-default items-center gap-2.5 rounded-control border border-hairline bg-panel-raised pr-2 pl-3 text-left text-sm outline-none transition-all",
          "hover:border-input focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          open && "border-input ring-2 ring-ring",
          className,
        )}
      >
        {icon && <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>}
        <span className={cn("min-w-0 flex-1 truncate", empty && "text-muted-foreground")}>
          {selected?.label ?? placeholder ?? "Auswählen"}
        </span>
        {selected?.hint && (
          <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 font-mono text-3xs text-primary">
            {selected.hint}
          </span>
        )}
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      {open &&
        placement &&
        createPortal(
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            className={cn(
              "fixed z-50 overflow-y-auto rounded-xl border border-hairline bg-popover p-1 shadow-pop",
              "animate-[pop-in_140ms_var(--ease-drawer)]",
            )}
            style={{
              left: placement.left,
              width: Math.max(placement.width, 220),
              top: placement.top,
              bottom: placement.bottom,
              maxHeight: placement.maxHeight,
            }}
          >
            {items.map((option, i) => {
              const isSelected = option.value === value;
              return (
                <div
                  key={option.value || "__empty"}
                  id={`${id}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(option)}
                  className={cn(
                    "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                    i === active && "bg-accent",
                    option.value === "" && "text-muted-foreground",
                  )}
                >
                  {option.icon && (
                    <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{option.icon}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint && (
                    <span className="shrink-0 font-mono text-3xs text-muted-foreground uppercase">{option.hint}</span>
                  )}
                  <Check className={cn("size-3.5 shrink-0 text-primary", !isSelected && "invisible")} />
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
