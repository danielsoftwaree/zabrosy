import { Button as BaseButton } from '@base-ui/react/button'
import type { ComponentProps } from 'react'

type Props = ComponentProps<typeof BaseButton> & {
  tone?: 'primary' | 'quiet'
}

export function Button({ className = '', tone = 'primary', ...props }: Props) {
  return <BaseButton className={`button button--${tone} ${className}`} {...props} />
}
