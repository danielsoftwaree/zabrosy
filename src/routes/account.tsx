import { createFileRoute } from '@tanstack/react-router'
import { AccountPanel } from '../modules/account'

export const Route = createFileRoute('/account')({ component: AccountPanel })
