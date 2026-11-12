import React from 'react';
import { kanbanAppointmentDetails } from '../../../services/kanban/kanbanAppointmentDetails.js';

// Bloco de detalhes do agendamento no card do Kanban (pedido, agendado, compareceu, não compareceu).
export function AppointmentDetails({ card, timeZone }) {
  const details = kanbanAppointmentDetails(card, { timeZone });
  if (!details) return null;
  const items = [
    details.services && { key: 'services', text: details.services },
    details.when && { key: 'when', text: details.when },
    details.professional && { key: 'professional', text: `Profissional: ${details.professional}` },
    details.firstVisit && { key: 'first-visit', text: `Primeira vez: ${details.firstVisit}` },
    details.durationUnknown && { key: 'duration', text: 'Duração a confirmar' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <ul className="appointment-request-details">
      {items.map((item) => <li key={item.key}>{item.text}</li>)}
    </ul>
  );
}
