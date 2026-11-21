import React from 'react';
import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';

/**
 * NoriaSelect - Componente reutilizável de seleção estilizado para a NORIA.
 *
 * @param {Object} props
 * @param {string} props.value - Valor atualmente selecionado.
 * @param {(value: string) => void} props.onValueChange - Callback acionado na seleção de novo valor.
 * @param {Array<{value: string, label: string, disabled?: boolean}>} props.options - Lista de opções.
 * @param {string} [props.ariaLabel='Selecionar opção'] - Rótulo de acessibilidade.
 * @param {string} [props.placeholder='Selecione...'] - Texto padrão quando nenhum valor estiver selecionado.
 * @param {React.ComponentType} [props.icon] - Ícone Lucide exibido à esquerda no trigger.
 * @param {string} [props.title] - Tooltip nativo no trigger.
 * @param {boolean} [props.disabled=false] - Desabilitar o componente.
 * @param {string} [props.className=''] - Classes adicionais no trigger.
 * @param {string} [props.contentClassName=''] - Classes adicionais no container de opções.
 */
export function NoriaSelect({
  value,
  onValueChange,
  options = [],
  ariaLabel = 'Selecionar opção',
  placeholder = 'Selecione...',
  icon: Icon,
  title,
  disabled = false,
  className = '',
  contentClassName = '',
}) {
  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  const hasCategories = options.some((opt) => Boolean(opt.category));
  const groups = React.useMemo(() => {
    if (!hasCategories) {
      return [{ category: null, items: options }];
    }
    const map = new Map();
    for (const opt of options) {
      const cat = opt.category || 'Outros';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(opt);
    }
    return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
  }, [options, hasCategories]);

  return (
    <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger
        className={`noria-select-trigger ${className}`}
        aria-label={ariaLabel}
        title={title || selectedOption?.label || ariaLabel}
      >
        {Icon && (
          <span className="noria-select-icon" aria-hidden="true">
            <Icon size={15} />
          </span>
        )}
        <span className="noria-select-value-wrap">
          <Select.Value placeholder={placeholder}>
            {selectedOption ? selectedOption.label : undefined}
          </Select.Value>
        </span>
        <Select.Icon asChild>
          <span className="noria-select-chevron" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          className={`noria-select-content ${contentClassName}`}
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          align="start"
        >
          <Select.Viewport className="noria-select-viewport">
            {groups.map((group, groupIdx) => (
              <Select.Group key={group.category || `group-${groupIdx}`} className="noria-select-group">
                {group.category && (
                  <Select.Label className="noria-select-group-label">
                    {group.category}
                  </Select.Label>
                )}
                {group.items.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={String(option.value)}
                    disabled={option.disabled}
                    className="noria-select-item"
                  >
                    {option.icon ? (
                      React.isValidElement(option.icon) ? (
                        option.icon
                      ) : (
                        <span className="noria-select-item-icon" aria-hidden="true">
                          <option.icon size={14} />
                        </span>
                      )
                    ) : (
                      <span className="noria-select-item-indicator-box" aria-hidden="true">
                        <Select.ItemIndicator className="noria-select-item-indicator">
                          <Check size={14} />
                        </Select.ItemIndicator>
                      </span>
                    )}
                    <Select.ItemText className="noria-select-item-text">
                      {option.label}
                    </Select.ItemText>
                    {option.icon && (
                      <span className="noria-select-item-indicator-box noria-select-item-indicator-end" aria-hidden="true">
                        <Select.ItemIndicator className="noria-select-item-indicator">
                          <Check size={14} />
                        </Select.ItemIndicator>
                      </span>
                    )}
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export default NoriaSelect;
