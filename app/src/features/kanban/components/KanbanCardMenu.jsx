import React, { useId, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';

export function KanbanCardMenu({ actions, title }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);
  const actionsId = useId();
  if (!actions.length) return null;

  function closeAndFocus() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  return (
    <div
      className="kanban-card-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        closeAndFocus();
      }}
    >
      <button
        ref={toggleRef}
        className="kanban-card-more"
        type="button"
        aria-label={`Mais ações de ${title}`}
        aria-expanded={open}
        aria-controls={actionsId}
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      <div id={actionsId} className="kanban-card-menu-actions" hidden={!open}>
        {actions.map(({ key, Icon, label, run, href, disabled, description }) => {
          const content = <><Icon size={14} aria-hidden="true" /><span>{label}</span></>;
          return href ? (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer" onClick={closeAndFocus}>{content}</a>
          ) : (
            <button key={key} type="button" title={description} disabled={disabled} onClick={() => {
              closeAndFocus();
              run();
            }}>{content}</button>
          );
        })}
      </div>
    </div>
  );
}
