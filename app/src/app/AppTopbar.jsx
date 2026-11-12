import React from 'react';
import { Building2, LogOut, Menu, RefreshCcw } from 'lucide-react';
import { NoriaSelect } from '../components/NoriaSelect';
import { NotificationCenter } from '../features/notifications/NotificationCenter.jsx';

export function AppTopbar({
  active,
  activeTenantSlug,
  availableTenants = [],
  handleSignOut,
  isAuthRequired,
  loading = false,
  menu = [],
  mobileNavOpen = false,
  onOpenMobileNav,
  refreshData,
  selectedTenant = {},
  setMobileNavOpen,
  setTenantSlug,
  notificationTenantId,
  notificationUserId,
  notificationSettings,
  notificationConversations,
  notificationConversationViewRef,
  notificationAppointments,
  notificationKanbanColumns,
  onOpenNotificationPage,
  onOpenNotificationConversation,
  onOpenNotificationCard,
}) {
  const handleOpenMobileNav = () => {
    if (onOpenMobileNav) {
      onOpenMobileNav();
    } else if (setMobileNavOpen) {
      setMobileNavOpen(true);
    }
  };

  const showSignOut = typeof isAuthRequired === 'function' ? isAuthRequired() : Boolean(isAuthRequired);

  return (
    <header className="topbar">
      <div className="topbar-brand-block kanban-title-block">
        <div className="topbar-title-row">
          <button
            type="button"
            className="mobile-menu-btn icon-button"
            onClick={handleOpenMobileNav}
            title="Menu"
            aria-label="Abrir navegação"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav-drawer"
          >
            <Menu size={18} />
          </button>
          <span className="kanban-title-accent" aria-hidden="true" />
          <h1>{menu?.find((item) => item.id === active)?.label}</h1>
        </div>
      </div>
      <div className="topbar-actions">
        <NoriaSelect
          value={activeTenantSlug}
          onValueChange={setTenantSlug}
          options={availableTenants?.map((tenant) => ({
            value: tenant.slug,
            label: tenant.name,
          })) || []}
          ariaLabel="Selecionar empresa"
          icon={Building2}
          title={selectedTenant?.name}
        />
        <div className="topbar-utility-buttons">
          <NotificationCenter
            key={JSON.stringify([activeTenantSlug, notificationTenantId, notificationUserId])}
            tenantId={notificationTenantId}
            userId={notificationUserId}
            tenantName={selectedTenant?.name}
            tenantSlug={activeTenantSlug}
            dataReady={!loading}
            role={selectedTenant?.membershipRole}
            settings={notificationSettings}
            conversations={notificationConversations}
            conversationViewRef={notificationConversationViewRef}
            appointments={notificationAppointments}
            kanbanColumns={notificationKanbanColumns}
            onOpenPage={onOpenNotificationPage}
            onOpenConversation={onOpenNotificationConversation}
            onOpenCard={onOpenNotificationCard}
          />
          <button className="icon-button" type="button" title="Atualizar" aria-label="Atualizar" onClick={refreshData}>
            <RefreshCcw size={17} className={loading ? 'spin' : ''} />
          </button>
          {showSignOut && (
            <button className="secondary-button logout-btn" type="button" title="Sair" aria-label="Sair" onClick={handleSignOut}>
              <LogOut size={16} />
              <span className="logout-text">Sair</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export default AppTopbar;
