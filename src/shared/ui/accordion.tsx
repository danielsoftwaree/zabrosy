import type { ReactNode } from 'react'
import { Accordion as BaseAccordion } from '@base-ui/react/accordion'
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown'

export function Accordion({ title, children, defaultOpen = false }: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return <BaseAccordion.Root className="accordion" defaultValue={defaultOpen ? ['content'] : []} keepMounted>
    <BaseAccordion.Item value="content">
      <BaseAccordion.Header className="accordion__heading">
        <BaseAccordion.Trigger className="accordion__trigger" type="button">{title}<CaretDown size={18} aria-hidden="true" /></BaseAccordion.Trigger>
      </BaseAccordion.Header>
      <BaseAccordion.Panel className="accordion__panel"><div>{children}</div></BaseAccordion.Panel>
    </BaseAccordion.Item>
  </BaseAccordion.Root>
}
