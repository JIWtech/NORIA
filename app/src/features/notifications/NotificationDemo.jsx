import React, { useState } from 'react';
import { NotificationPanel } from './NotificationPanel.jsx';

function samples() {
  const now = new Date();
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const date = (day, hour, minute) => {
    const value = new Date(day);
    value.setHours(hour, minute, 0, 0);
    return value.toISOString();
  };
  return [
    { id: 'human', kind: 'handoff', title: 'Cliente aguardando a equipe', description: 'O atendimento foi encaminhado e segue sem resposta.',
      category: 'conversations', contact: 'Marina Lopes', createdAt: date(today, 10, 42), unread: true, pending: true, overdue: true },
    { id: 'request', kind: 'appointment-request', title: 'Pedido aguardando confirmação', description: 'Corte e escova, amanhã às 15h.',
      category: 'appointments', contact: 'Camila Duarte', createdAt: date(today, 10, 18), unread: true, pending: true },
    { id: 'payment', kind: 'deposit-review', title: 'Sinal aguardando conferência', description: 'A cliente informou o pagamento da reserva.',
      category: 'appointments', contact: 'Beatriz Lima', createdAt: date(today, 9, 57), unread: true, pending: true },
    { id: 'assigned', kind: 'assignment', title: 'Conversa atribuída', description: 'A conversa foi direcionada à equipe comercial.',
      category: 'conversations', contact: 'Rafael Costa', createdAt: date(yesterday, 16, 24), unread: false },
    { id: 'resolved', kind: 'appointment', appointmentStatus: 'confirmed', title: 'Agendamento confirmado', description: 'A equipe confirmou a reserva.',
      category: 'appointments', contact: 'Helena Souza', createdAt: date(yesterday, 14, 20), unread: false, resolved: true },
  ];
}

const examples = [
  ['closed', 'conversations', 'Atendimento encerrado', 'A conversa foi finalizada pela equipe.'],
  ['message', 'conversations', 'Nova mensagem de cliente', 'Oi! Posso confirmar o horário da semana que vem? Se houver uma vaga na parte da manhã, prefiro esse período.'],
  ['assignment', 'conversations', 'Conversa atribuída', 'Um responsável assumiu a conversa.'],
  ['appointment', 'appointments', 'Agendamento confirmado', 'A equipe confirmou o horário.', 'confirmed'],
  ['payment-confirmed', 'appointments', 'Sinal confirmado', 'A equipe conferiu o pagamento.'],
  ['delivery', 'attention', 'Confira o envio da mensagem', 'A entrega ainda não foi confirmada.'],
  ['lead', 'leads', 'Novo lead recebido', 'Um novo contato entrou no funil.'],
  ['appointment-cancelled', 'appointments', 'Agendamento cancelado', 'O horário foi liberado na agenda.'],
  ['attachment', 'attention', 'Anexo não carregou', 'Abra a conversa para conferir o arquivo.'],
];
const contacts = ['Marina Lopes', 'Camila Duarte', 'Beatriz Lima', 'Rafael Costa', 'Helena Souza', 'Joana Dias'];

function volumeSamples() {
  const additional = Array.from({ length: 45 }, (_, index) => {
    const [kind, category, title, description, appointmentStatus] = examples[index % examples.length];
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(index / 20));
    date.setHours(11, 30 - (index % 20) * 8, 0, 0);
    const contactIndex = Math.floor(index / examples.length) % 3;
    return {
      id: `volume-${index}`, kind, category, title, description, appointmentStatus,
      channel: 'whatsapp', chatId: `demo-thread-${contactIndex}`, contact: contacts[contactIndex + 3],
      createdAt: date.toISOString(), unread: index % 3 === 0,
    };
  });
  // Três mensagens do mesmo tipo e da mesma conversa exercitam o agrupamento.
  for (const index of [8, 16]) {
    const { id, createdAt, unread } = additional[index];
    additional[index] = { ...additional[1], id, createdAt, unread };
  }
  return [...samples(), ...additional];
}

export function NotificationDemo() {
  const [items, setItems] = useState(() => new URLSearchParams(window.location.search).get('volume') === '50' ? volumeSamples() : samples());
  const [sound, setSound] = useState(false);
  const [status, setStatus] = useState('');
  return <main style={{ minHeight: '100dvh' }}>
    <header className="topbar">
      <div className="topbar-title-row"><span className="kanban-title-accent" /><h1>Noria</h1></div>
      <div className="topbar-actions">
        <NotificationPanel tenantName="Noria" simulation items={items} unread={items.filter(item => item.unread).length}
          inbox={{}} sound={{ enabled: sound, toggle: () => setSound(previous => !previous) }}
          onSettings={() => setStatus('Configurações selecionadas.')}
          onMarkRead={item => setItems(previous => previous.map(row => row.id === item.id ? { ...row, unread: false } : row))}
          onMarkAll={() => setItems(previous => previous.map(row => ({ ...row, unread: false })))}
          actionFor={item => item.pending ? {
            label: { human: 'Abrir conversa', request: 'Ver pedido', payment: 'Verificar sinal' }[item.id],
            run: () => {
              setItems(previous => previous.map(row => row.id === item.id ? { ...row, pending: false, overdue: false, resolved: true } : row));
              setStatus(`${item.title}: resolução simulada.`);
            },
          } : null}
        />
      </div>
    </header>
    <section style={{ padding: '24px', maxWidth: '620px' }}>
      <p>Dados fictícios da operação Noria. Os atalhos simulam a resolução da tarefa.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <button className="secondary-button" type="button" onClick={() => { setItems(samples()); setStatus('Exemplos restaurados.'); }}>Restaurar exemplos</button>
        <button className="secondary-button" type="button" onClick={() => { setItems(volumeSamples()); setStatus('50 avisos simulados.'); }}>Simular 50 avisos</button>
        <button className="secondary-button" type="button" onClick={() => { setItems([]); setStatus('Lista vazia.'); }}>Testar lista vazia</button>
      </div>
      <p role="status">{status}</p>
    </section>
  </main>;
}
