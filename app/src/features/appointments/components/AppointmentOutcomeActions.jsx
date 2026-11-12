import React from 'react';
import { Check, UserX } from 'lucide-react';

export const APPOINTMENT_OUTCOME_ACTIONS = {
  attended: { Icon: Check, label: 'Marcar presença', description: 'Registrar que o cliente compareceu' },
  no_show: { Icon: UserX, label: 'Marcar falta', description: 'Registrar que o cliente não compareceu' },
};

export function AppointmentOutcomeActions({ outcomes, disabled, busy, onOutcome }) {
  if (!outcomes.length) return null;

  return (
    <div className="appointment-outcome-actions" aria-busy={busy || undefined}>
      {outcomes.map((outcome) => {
        const { Icon, label, description } = APPOINTMENT_OUTCOME_ACTIONS[outcome];
        return (
          <button
            key={outcome}
            type="button"
            className={`outcome-button outcome-button--${outcome}`}
            title={description}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onOutcome(outcome);
            }}
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
